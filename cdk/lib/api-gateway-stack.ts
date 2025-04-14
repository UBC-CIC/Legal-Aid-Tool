import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import {
  Architecture,
  Code,
  Function,
  LayerVersion,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
//import { VpcStack } from './vpc-stack';
import * as cognito from "aws-cdk-lib/aws-cognito";
import { CfnJson } from "aws-cdk-lib";
import { VpcStack } from "./vpc-stack";
import { DatabaseStack } from "./database-stack";
import { parse, stringify } from "yaml";
import { Fn } from "aws-cdk-lib";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { text } from "stream/consumers";

export class ApiGatewayStack extends cdk.Stack {
  private readonly api: apigateway.SpecRestApi;
  public readonly appClient: cognito.UserPoolClient;
  public readonly userPool: cognito.UserPool;
  public readonly identityPool: cognito.CfnIdentityPool;
  private readonly layerList: { [key: string]: LayerVersion };
  public readonly stageARN_APIGW: string;
  public readonly apiGW_basedURL: string;
  public readonly secret: secretsmanager.ISecret;
  public getEndpointUrl = () => this.api.url;
  public getUserPoolId = () => this.userPool.userPoolId;
  public getUserPoolClientId = () => this.appClient.userPoolClientId;
  public getIdentityPoolId = () => this.identityPool.ref;
  public addLayer = (name: string, layer: LayerVersion) =>
    (this.layerList[name] = layer);
  public getLayers = () => this.layerList;
  constructor(
    scope: Construct,
    id: string,
    db: DatabaseStack,
    vpcStack: VpcStack,
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    this.layerList = {};

    const promptStorageBucket = new s3.Bucket(
      this,
      `${id}-system-prompt-bucket`,
      {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        cors: [
          {
            allowedHeaders: ["*"],
            allowedMethods: [
              s3.HttpMethods.GET,
              s3.HttpMethods.PUT,
              s3.HttpMethods.HEAD,
              s3.HttpMethods.POST,
              s3.HttpMethods.DELETE,
            ],
            allowedOrigins: ["*"],
          },
        ],
        // When deleting the stack, need to empty the Bucket and delete it manually
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        enforceSSL: true,
      }
    );

    const audioStorageBucket = new s3.Bucket(
      this,
      `${id}-audio-prompt-bucket`,
      {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        cors: [
          {
            allowedHeaders: ["*"],
            allowedMethods: [
              s3.HttpMethods.GET,
              s3.HttpMethods.PUT,
              s3.HttpMethods.HEAD,
              s3.HttpMethods.POST,
              s3.HttpMethods.DELETE,
            ],
            allowedOrigins: ["*"],
          },
        ],
        // When deleting the stack, need to empty the Bucket and delete it manually
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        enforceSSL: true,
      }
    );


    // // Create FIFO SQS Queue
    // const audioToTextQueue = new sqs.Queue(this, `${id}-AudioToTextQueue`, {
    //   queueName: `${id}-audioToText-queue.fifo`,
    //   fifo: true,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   visibilityTimeout: cdk.Duration.seconds(900),
    // });

    // // Create FIFO SQS Queue
    // const textToLlmQueue = new sqs.Queue(this, `${id}-TextToLlmQueue`, {
    //   queueName: `${id}-textToLlm-queue.fifo`,
    //   fifo: true,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   visibilityTimeout: cdk.Duration.seconds(900),
    // });



    
    /**
     *
     * Create Integration Lambda layer for aws-jwt-verify
     */
    const jwt = new lambda.LayerVersion(this, "aws-jwt-verify", {
      code: lambda.Code.fromAsset("./layers/aws-jwt-verify.zip"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: "Contains the aws-jwt-verify library for JS",
    });

    /**
     *
     * Create Integration Lambda layer for PSQL
     */
    const postgres = new lambda.LayerVersion(this, "postgres", {
      code: lambda.Code.fromAsset("./layers/postgres.zip"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: "Contains the postgres library for JS",
    });

    /**
     *
     * Create Lambda layer for Psycopg2
     */
    const psycopgLayer = new LayerVersion(this, "psycopgLambdaLayer", {
      code: Code.fromAsset("./layers/psycopg2.zip"),
      compatibleRuntimes: [Runtime.PYTHON_3_9],
      description: "Lambda layer containing the psycopg2 Python library",
    });

    // powertoolsLayer does not follow the format of layerList
    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      `${id}-PowertoolsLayer`,
      `arn:aws:lambda:${this.region}:017000801446:layer:AWSLambdaPowertoolsPythonV2:78`
    );

    this.layerList["psycopg2"] = psycopgLayer;
    this.layerList["postgres"] = postgres;
    this.layerList["jwt"] = jwt;

    // Create Cognito user pool

    /**
     *
     * Create Cognito User Pool
     * Using verification code
     * Inspiration from http://buraktas.com/create-cognito-user-pool-aws-cdk/
     */
    const userPoolName = `${id}-UserPool`;
    this.userPool = new cognito.UserPool(this, `${id}-pool`, {
      userPoolName: userPoolName,
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
      },
      userVerification: {
        emailSubject: "Please verify your email",
        emailBody: `
          <html>
            <head>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  background-color: #f4f7fc;
                  color: #333;
                  margin: 0;
                  padding: 0;
                  font-size: 16px;
                }
                .email-container {
                  background-color: #ffffff;
                  width: 100%;
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                }
                .header {
                  text-align: center;
                  margin-bottom: 20px;
                }
                .header img {
                  width: 100px;
                  height: auto;
                }
                .main-content {
                  text-align: center;
                  font-size: 18px;
                  color: #444;
                  margin-bottom: 30px;
                }
                .code {
                  display: inline-block;
                  background-color: #546bdf;
                  color: #ffffff;
                  font-size: 24px;
                  font-weight: bold;
                  padding: 15px 25px;
                  border-radius: 4px;
                  margin-top: 20px;
                  margin-bottom: 20px;
                }
                .footer {
                  text-align: center;
                  font-size: 14px;
                  color: #888;
                }
                .footer a {
                  color: #546bdf;
                  text-decoration: none;
                }
              </style>
            </head>
            <body>
              <div class="email-container">
                <div class="header">
                  <h1>Legal Aid Tool</h1>
                </div>
                <div class="main-content">
                  <p>Thank you for signing up for Legal Aid Tool!</p>
                  <p>Please verify your email by using the code below:</p>
                  <div class="code">{####}</div>
                  <p>If you did not request this verification, please ignore this email.</p>
                </div>
                <div class="footer">
                  <p>Legal Aid Tool &copy; 2025</p>
                </div>
              </div>
            </body>
          </html>
        `,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create app client
    this.appClient = this.userPool.addClient(`${id}-pool`, {
      userPoolClientName: userPoolName,
      authFlows: {
        userPassword: true,
        custom: true,
        userSrp: true,
      },
    });

    this.identityPool = new cognito.CfnIdentityPool(
      this,
      `${id}-identity-pool`,
      {
        allowUnauthenticatedIdentities: true,
        identityPoolName: `${id}-IdentityPool`,
        cognitoIdentityProviders: [
          {
            clientId: this.appClient.userPoolClientId,
            providerName: this.userPool.userPoolProviderName,
          },
        ],
      }
    );

    const secretsName = `${id}-LAT_Cognito_Secrets`;

    this.secret = new secretsmanager.Secret(this, secretsName, {
      secretName: secretsName,
      description: "Cognito Secrets for authentication",
      secretObjectValue: {
        VITE_COGNITO_USER_POOL_ID: cdk.SecretValue.unsafePlainText(
          this.userPool.userPoolId
        ),
        VITE_COGNITO_USER_POOL_CLIENT_ID: cdk.SecretValue.unsafePlainText(
          this.appClient.userPoolClientId
        ),
        VITE_AWS_REGION: cdk.SecretValue.unsafePlainText(this.region),
        VITE_IDENTITY_POOL_ID: cdk.SecretValue.unsafePlainText(
          this.identityPool.ref
        ),
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create roles and policies
    const createPolicyStatement = (actions: string[], resources: string[]) => {
      return new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: actions,
        resources: resources,
      });
    };

    /**
     *
     * Load OpenAPI file into API Gateway using REST API
     */

    // Read OpenAPI file and load file to S3
    const asset = new Asset(this, "SampleAsset", {
      path: "OpenAPI_Swagger_Definition.yaml",
    });

    const data = Fn.transform("AWS::Include", { Location: asset.s3ObjectUrl });

    // Create the API Gateway REST API
    this.api = new apigateway.SpecRestApi(this, `${id}-APIGateway`, {
      apiDefinition: apigateway.AssetApiDefinition.fromInline(data),
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      restApiName: `${id}-API`,
      deploy: true,
      cloudWatchRole: true,
      deployOptions: {
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: true,
        stageName: "prod",
        methodOptions: {
          "/*/*": {
            throttlingRateLimit: 100,
            throttlingBurstLimit: 200,
          },
        },
      },
    });

    this.stageARN_APIGW = this.api.deploymentStage.stageArn;
    this.apiGW_basedURL = this.api.urlForPath();

    const studentRole = new iam.Role(this, `${id}-StudentRole`, {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    studentRole.attachInlinePolicy(
      new iam.Policy(this, `${id}-StudentPolicy`, {
        statements: [
          createPolicyStatement(
            ["execute-api:Invoke"],
            [
              `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student/*`,
            ]
          ),
        ],
      })
    );

    const instructorRole = new iam.Role(this, `${id}-InstructorRole`, {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    instructorRole.attachInlinePolicy(
      new iam.Policy(this, `${id}-InstructorPolicy`, {
        statements: [
          createPolicyStatement(
            ["execute-api:Invoke"],
            [
              `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor/*`,
            ]
          ),
        ],
      })
    );

    const adminRole = new iam.Role(this, `${id}-AdminRole`, {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    adminRole.attachInlinePolicy(
      new iam.Policy(this, `${id}-AdminPolicy`, {
        statements: [
          createPolicyStatement(
            ["execute-api:Invoke"],
            [
              `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/admin/*`,
              `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor/*`,
              `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student/*`,
            ]
          ),
        ],
      })
    );

    const techAdminRole = new iam.Role(this, `${id}-TechAdminRole`, {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    techAdminRole.attachInlinePolicy(
      new iam.Policy(this, `${id}-TechAdminPolicy`, {
        statements: [
          createPolicyStatement(
            ["execute-api:Invoke"],
            [
              `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*`,
            ]
          ),
        ],
      })
    );

    // Create Cognito user pool groups
    const studentGroup = new cognito.CfnUserPoolGroup(this, `${id}-StudentGroup`, {
      groupName: "student",
      userPoolId: this.userPool.userPoolId,
      roleArn: studentRole.roleArn,
    });

    const instructorGroup = new cognito.CfnUserPoolGroup(
      this,
      `${id}-InstructorGroup`,
      {
        groupName: "instructor",
        userPoolId: this.userPool.userPoolId,
        roleArn: instructorRole.roleArn,
      }
    );

    const adminGroup = new cognito.CfnUserPoolGroup(this, `${id}-AdminGroup`, {
      groupName: "admin",
      userPoolId: this.userPool.userPoolId,
      roleArn: adminRole.roleArn,
    });

    const techAdminGroup = new cognito.CfnUserPoolGroup(
      this,
      `${id}-TechAdminGroup`,
      {
        groupName: "techadmin",
        userPoolId: this.userPool.userPoolId,
        roleArn: techAdminRole.roleArn,
      }
    );

    // Create unauthenticated role with no permissions
    const unauthenticatedRole = new iam.Role(this, `${id}-UnauthenticatedRole`, {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "unauthenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    const lambdaRole = new iam.Role(this, `${id}-postgresLambdaRole-${this.region}`, {
      roleName: `${id}-postgresLambdaRole-${this.region}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // Grant access to Secret Manager
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Grant access to EC2
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses",
        ],
        resources: ["*"], // must be *
      })
    );

    // Grant access to log
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Logs
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["arn:aws:logs:*:*:*"],
      })
    );

    // Inline policy to allow AdminAddUserToGroup action
    const adminAddUserToGroupPolicyLambda = new iam.Policy(
      this,
      `${id}-adminAddUserToGroupPolicyLambda`,
      {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "cognito-idp:AdminAddUserToGroup",
              "cognito-idp:AdminRemoveUserFromGroup",
              "cognito-idp:AdminGetUser",
              "cognito-idp:AdminListGroupsForUser",
            ],
            resources: [
              `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${this.userPool.userPoolId}`,
            ],
          }),
        ],
      }
    );

    // Attach the inline policy to the role
    lambdaRole.attachInlinePolicy(adminAddUserToGroupPolicyLambda);

    // Attach roles to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, `${id}-IdentityPoolRoles`, {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: studentRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });

    // Create S3 Bucket to store notes for each case
    const noteStorageBucket = new s3.Bucket(this, `${id}-NoteStorageBucket`, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ["*"],
        },
      ],
      // When deleting the stack, need to empty the Bucket and delete it manually
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
    });

    

    const lambdaStudentFunction = new lambda.Function(this, `${id}-studentFunction`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lambda/lib"),
      handler: "studentFunction.handler",
      timeout: Duration.seconds(300),
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        USER_POOL: this.userPool.userPoolId,
        BUCKET: noteStorageBucket.bucketName,
      },
      functionName: `${id}-studentFunction`,
      memorySize: 512,
      layers: [postgres],
      role: lambdaRole,
    });

    noteStorageBucket.grantReadWrite(lambdaStudentFunction);
    lambdaStudentFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject"],
        resources: [
          noteStorageBucket.bucketArn,
          `${noteStorageBucket.bucketArn}/*`,
        ],
      })
    );

    // Allow access to DynamoDB Table for reading chat history
    lambdaStudentFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/DynamoDB-Conversation-Table`
        ],
        effect: iam.Effect.ALLOW
      })
    );   

    // Add the permission to the Lambda function's policy to allow API Gateway access
    lambdaStudentFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    const cfnLambda_student = lambdaStudentFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnLambda_student.overrideLogicalId("studentFunction");

    const lambdaInstructorFunction = new lambda.Function(
      this,
      `${id}-instructorFunction`,
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        code: lambda.Code.fromAsset("lambda/lib"),
        handler: "instructorFunction.handler",
        timeout: Duration.seconds(300),
        vpc: vpcStack.vpc,
        environment: {
          SM_DB_CREDENTIALS: db.secretPathUser.secretName,
          RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
          USER_POOL: this.userPool.userPoolId,
        },
        functionName: `${id}-instructorFunction`,
        memorySize: 512,
        layers: [postgres],
        role: lambdaRole,
      }
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    lambdaInstructorFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor*`,
    });

    // Allow access to DynamoDB Table for reading chat history
    lambdaInstructorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/DynamoDB-Conversation-Table`
        ],
        effect: iam.Effect.ALLOW
      })
    );    

    const cfnLambda_Instructor = lambdaInstructorFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnLambda_Instructor.overrideLogicalId("instructorFunction");

    const lambdaAdminFunction = new lambda.Function(this, `${id}-adminFunction`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lambda/adminFunction"),
      handler: "adminFunction.handler",
      timeout: Duration.seconds(300),
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathTableCreator.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpointTableCreator,
      },
      functionName: `${id}-adminFunction`,
      memorySize: 512,
      layers: [postgres],
      role: lambdaRole,
    });

    // Add the permission to the Lambda function's policy to allow API Gateway access
    lambdaAdminFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/admin*`,
    });

    const cfnLambda_Admin = lambdaAdminFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnLambda_Admin.overrideLogicalId("adminFunction");

    const coglambdaRole = new iam.Role(this, `${id}-cognitoLambdaRole-${this.region}`, {
      roleName: `${id}-cognitoLambdaRole-${this.region}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // Grant access to Secret Manager
    coglambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Grant access to EC2
    coglambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses",
        ],
        resources: ["*"], // must be *
      })
    );

    // Grant access to log
    coglambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Logs
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["arn:aws:logs:*:*:*"],
      })
    );

    // Grant permission to add users to an IAM group
    coglambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:AddUserToGroup"],
        resources: [
          `arn:aws:iam::${this.account}:user/*`,
          `arn:aws:iam::${this.account}:group/*`,
        ],
      })
    );

    // Inline policy to allow AdminAddUserToGroup action
    const adminAddUserToGroupPolicy = new iam.Policy(
      this,
      `${id}-AdminAddUserToGroupPolicy`,
      {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "cognito-idp:AdminAddUserToGroup",
              "cognito-idp:AdminRemoveUserFromGroup",
              "cognito-idp:AdminGetUser",
              "cognito-idp:AdminListGroupsForUser",
            ],
            resources: [
              `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${this.userPool.userPoolId}`,
            ],
          }),
        ],
      }
    );

    // Attach the inline policy to the role
    coglambdaRole.attachInlinePolicy(adminAddUserToGroupPolicy);

    coglambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          // Secrets Manager
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    coglambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/*`],
      })
    );

    const AutoSignupLambda = new lambda.Function(this, `${id}-addStudentOnSignUp`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lambda/lib"),
      handler: "addStudentOnSignUp.handler",
      timeout: Duration.seconds(300),
      environment: {
        SM_DB_CREDENTIALS: db.secretPathTableCreator.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpointTableCreator,
      },
      vpc: vpcStack.vpc,
      functionName: `${id}-addStudentOnSignUp`,
      memorySize: 128,
      layers: [postgres],
      role: coglambdaRole,
    });

    // const sqsFunction = new lambda.Function(this, `${id}-sqsFunction`, {
    //   runtime: lambda.Runtime.NODEJS_20_X,
    //   handler: "sqs.handler",
    //   memorySize: 512,
    //   code: lambda.Code.fromAsset("lambda/sqs"),
    //   timeout: cdk.Duration.seconds(900),
    //   environment: {
    //     SQS_QUEUE_URL: audioToTextQueue.queueUrl,
    //   },
    //   vpc: vpcStack.vpc,
    //   role: coglambdaRole,
    // });

    // sqsFunction.addEventSource(
    //   new lambdaEventSources.S3EventSource(audioStorageBucket, {
    //     events: [
    //       s3.EventType.OBJECT_CREATED,
    //       s3.EventType.OBJECT_RESTORE_COMPLETED,
    //     ],
    //   })
    // );

    // audioToTextQueue.grantSendMessages(sqsFunction);

    const audioToTextFunction = new lambda.Function(this, `${id}-audioToTextFunction`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/audioToText"),
      handler: "main.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        AUDIO_BUCKET: audioStorageBucket.bucketName,
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
      },
      functionName: `${id}-audioToTextFunction`,
      layers: [powertoolsLayer],
      role: coglambdaRole,
    });

    // textToLlmQueue.grantSendMessages(audioToTextFunction);

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnAudioToTextFunction = audioToTextFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnAudioToTextFunction.overrideLogicalId("audioToTextFunction");
    // audioToTextQueue.grantConsumeMessages(audioToTextFunction);
    // Grant the Lambda function read-only permissions to the S3 bucket
    audioStorageBucket.grantRead(audioToTextFunction);

    // audioToTextFunction.addEventSource(
    //   new lambdaEventSources.SqsEventSource(audioToTextQueue, {
    //     batchSize: 5,
    //   })
    // );

    audioToTextFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:ListBucket"],
        resources: [audioStorageBucket.bucketArn], // Access to the specific bucket
      })
    );

    audioToTextFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:HeadObject",
        ],
        resources: [
          `arn:aws:s3:::${audioStorageBucket.bucketName}/*`, // Grant access to all objects within this bucket
        ],
      })
    );

    // Grant access to Secret Manager
    audioToTextFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    audioToTextFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/admin*`,
    });
      
    // Add this to your CDK code where you're setting up the Lambda function's permissions
    audioToTextFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "transcribe:StartTranscriptionJob",
          "transcribe:GetTranscriptionJob",
          "transcribe:ListTranscriptionJobs"
        ],
        resources: [`arn:aws:transcribe:${this.region}:${this.account}:transcription-job/*`] // You can restrict this to specific resources if needed
      })
    );

    const adjustUserRoles = new lambda.Function(this, `${id}-adjustUserRoles`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lambda/lib"),
      handler: "adjustUserRoles.handler",
      timeout: Duration.seconds(300),
      environment: {
        SM_DB_CREDENTIALS: db.secretPathTableCreator.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpointTableCreator,
      },
      vpc: db.dbInstance.vpc,
      functionName: `${id}-adjustUserRoles`,
      memorySize: 512,
      layers: [postgres],
      role: coglambdaRole,
    });

    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_AUTHENTICATION,
      adjustUserRoles
    );

    //cognito auto assign authenticated users to the student group

    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_CONFIRMATION,
      AutoSignupLambda
    );

    // const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'latAuthorizer', {
    //   cognitoUserPools: [this.userPool],
    // });
    new cdk.CfnOutput(this, `${id}-UserPoolIdOutput`, {
      value: this.userPool.userPoolId,
      description: "The ID of the Cognito User Pool",
    });

    const preSignupLambda = new lambda.Function(this, `preSignupLambda`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset("lambda/lib"),
      handler: "preSignup.handler",
      timeout: Duration.seconds(300),
      environment: {
        ALLOWED_EMAIL_DOMAINS: "/LAT/AllowedEmailDomains",
      },
      vpc: vpcStack.vpc,
      functionName: `${id}-preSignupLambda`,
      memorySize: 128,
      role: coglambdaRole,
    });
    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_SIGN_UP,
      preSignupLambda
    );

    // **
    //  *
    //  * Create Lambda for Admin Authorization endpoints
    //  */
    const authorizationFunction = new lambda.Function(
      this,
      `${id}-admin-authorization-api-gateway`,
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        code: lambda.Code.fromAsset("lambda/adminAuthorizerFunction"),
        handler: "adminAuthorizerFunction.handler",
        timeout: Duration.seconds(300),
        vpc: vpcStack.vpc,
        environment: {
          SM_COGNITO_CREDENTIALS: this.secret.secretName,
        },
        functionName: `${id}-adminLambdaAuthorizer`,
        memorySize: 512,
        layers: [jwt],
        role: lambdaRole,
      }
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    authorizationFunction.grantInvoke(
      new iam.ServicePrincipal("apigateway.amazonaws.com")
    );

    // Change Logical ID to match the one decleared in YAML file of Open API
    const apiGW_authorizationFunction = authorizationFunction.node
      .defaultChild as lambda.CfnFunction;
    apiGW_authorizationFunction.overrideLogicalId("adminLambdaAuthorizer");

    /**
     *
     * Create Lambda for User Authorization endpoints
     */
    const authorizationFunction_student = new lambda.Function(
      this,
      `${id}-student-authorization-api-gateway`,
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        code: lambda.Code.fromAsset("lambda/studentAuthorizerFunction"),
        handler: "studentAuthorizerFunction.handler",
        timeout: Duration.seconds(300),
        vpc: vpcStack.vpc,
        environment: {
          SM_COGNITO_CREDENTIALS: this.secret.secretName,
        },
        functionName: `${id}-studentLambdaAuthorizer`,
        memorySize: 512,
        layers: [jwt],
        role: lambdaRole,
      }
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    authorizationFunction_student.grantInvoke(
      new iam.ServicePrincipal("apigateway.amazonaws.com")
    );

    // Change Logical ID to match the one decleared in YAML file of Open API
    const apiGW_authorizationFunction_student = authorizationFunction_student
      .node.defaultChild as lambda.CfnFunction;
    apiGW_authorizationFunction_student.overrideLogicalId(
      "studentLambdaAuthorizer"
    );

    /**
     *
     * Create Lambda for User Authorization endpoints
     */
    const authorizationFunction_instructor = new lambda.Function(
      this,
      `${id}-instructor-authorization-api-gateway`,
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        code: lambda.Code.fromAsset("lambda/instructorAuthorizerFunction"),
        handler: "instructorAuthorizerFunction.handler",
        timeout: Duration.seconds(300),
        vpc: vpcStack.vpc,
        environment: {
          SM_COGNITO_CREDENTIALS: this.secret.secretName,
        },
        functionName: `${id}-instructorLambdaAuthorizer`,
        memorySize: 512,
        layers: [jwt],
        role: lambdaRole,
      }
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    authorizationFunction_instructor.grantInvoke(
      new iam.ServicePrincipal("apigateway.amazonaws.com")
    );

    // Change Logical ID to match the one decleared in YAML file of Open API
    const apiGW_authorizationFunction_instructor =
      authorizationFunction_instructor.node.defaultChild as lambda.CfnFunction;
    apiGW_authorizationFunction_instructor.overrideLogicalId(
      "instructorLambdaAuthorizer"
    );

    // Create parameters for Bedrock LLM ID, Embedding Model ID, and Table Name in Parameter Store
    const bedrockLLMParameter = new ssm.StringParameter(this, "BedrockLLMParameter", {
      parameterName: `/${id}/LAT/BedrockLLMId`,
      description: "Parameter containing the Bedrock LLM ID",
      stringValue: "meta.llama3-70b-instruct-v1:0",
    });

    const embeddingModelParameter = new ssm.StringParameter(this, "EmbeddingModelParameter", {
      parameterName: `/${id}/LAT/EmbeddingModelId`,
      description: "Parameter containing the Embedding Model ID",
      stringValue: "amazon.titan-embed-text-v2:0",
    });

    const tableNameParameter = new ssm.StringParameter(this, "TableNameParameter", {
      parameterName: `/${id}/LAT/TableName`,
      description: "Parameter containing the DynamoDB table name",
      stringValue: "DynamoDB-Conversation-Table",
    });

    /**
     *
     * Create Lambda with container image for text generation workflow in RAG pipeline
     */
    const textGenLambdaDockerFunc = new lambda.DockerImageFunction(
      this,
      `${id}-TextGenLambdaDockerFunction`,
      {
        code: lambda.DockerImageCode.fromImageAsset("./text_generation"),
        memorySize: 512,
        timeout: cdk.Duration.seconds(300),
        vpc: vpcStack.vpc, // Pass the VPC
        functionName: `${id}-TextGenLambdaDockerFunction`,
        environment: {
          SM_DB_CREDENTIALS: db.secretPathAdminName,
          RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
          REGION: this.region,
          BEDROCK_LLM_PARAM: bedrockLLMParameter.parameterName,
          EMBEDDING_MODEL_PARAM: embeddingModelParameter.parameterName,
          TABLE_NAME_PARAM: tableNameParameter.parameterName,
          PROMPT_BUCKET_NAME: promptStorageBucket.bucketName,
        },
      }
    );

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnTextGenDockerFunc = textGenLambdaDockerFunc.node
      .defaultChild as lambda.CfnFunction;
    cfnTextGenDockerFunc.overrideLogicalId("TextGenLambdaDockerFunc");

    // Add the permission to the Lambda function's policy to allow API Gateway access
    textGenLambdaDockerFunc.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    textGenLambdaDockerFunc.role?.attachInlinePolicy(
      new iam.Policy(this, "S3ReadWritePolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:PutObject"],
            resources: [`arn:aws:s3:::${promptStorageBucket.bucketName}/*`], // Adjust bucket name
            effect: iam.Effect.ALLOW,
          }),
        ],
      })
    );

    textGenLambdaDockerFunc.role?.attachInlinePolicy(
      new iam.Policy(this, "DynamoDBReadWritePolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: [
              "dynamodb:PutItem",
              "dynamodb:GetItem",
              "dynamodb:Query",
            ],
            resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/*`],
            effect: iam.Effect.ALLOW,
          }),
        ],
      })
    );

    const bedrockPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-70b-instruct-v1`,
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-70b-instruct-v1:0`,  // Explicitly add the versioned model
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,  // If using Titan
      ],
    });       
    
    // Attach the corrected Bedrock policy to Lambda
    textGenLambdaDockerFunc.addToRolePolicy(bedrockPolicyStatement);

    // Grant access to Secret Manager
    textGenLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Grant access to DynamoDB actions
    textGenLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:ListTables",
          "dynamodb:CreateTable",
          "dynamodb:DescribeTable",
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
        ],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/*`],
      })
    );

    // Grant access to SSM Parameter Store for specific parameters
    textGenLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          bedrockLLMParameter.parameterArn,
          embeddingModelParameter.parameterArn,
          tableNameParameter.parameterArn,
        ],
      })
    );



    const titleGenLambdaDockerFunc = new lambda.DockerImageFunction(
      this,
      `${id}-TitleGenLambdaDockerFunction`,
      {
        code: lambda.DockerImageCode.fromImageAsset("./title_generation"),
        memorySize: 512,
        timeout: cdk.Duration.seconds(300),
        vpc: vpcStack.vpc, // Pass the VPC
        functionName: `${id}-TitleLambdaDockerFunction`,
        environment: {
          SM_DB_CREDENTIALS: db.secretPathAdminName,
          RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
          REGION: this.region,
          BEDROCK_LLM_PARAM: bedrockLLMParameter.parameterName,
          TABLE_NAME_PARAM: tableNameParameter.parameterName,
        },
      }
    );

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnTitleGenDockerFunc = titleGenLambdaDockerFunc.node
      .defaultChild as lambda.CfnFunction;
    cfnTitleGenDockerFunc.overrideLogicalId("TitleGenLambdaDockerFunc");

    // Add the permission to the Lambda function's policy to allow API Gateway access
    titleGenLambdaDockerFunc.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });


    // Attach the corrected Bedrock policy to Lambda
    titleGenLambdaDockerFunc.addToRolePolicy(bedrockPolicyStatement);

    // Grant access to Secret Manager
    titleGenLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

       // Grant access to SSM Parameter Store for specific parameters
       titleGenLambdaDockerFunc.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ssm:GetParameter"],
          resources: [
            bedrockLLMParameter.parameterArn,
            embeddingModelParameter.parameterArn,
            tableNameParameter.parameterArn,
          ],
        })
      );


    const summaryLambdaDockerFunc = new lambda.DockerImageFunction(
      this,
      `${id}-SummaryLambdaDockerFunction`,
      {
        code: lambda.DockerImageCode.fromImageAsset("./summary_generation"),
        memorySize: 512,
        timeout: cdk.Duration.seconds(300),
        vpc: vpcStack.vpc, // Pass the VPC
        functionName: `${id}-SummaryLambdaDockerFunction`,
        environment: {
          SM_DB_CREDENTIALS: db.secretPathAdminName,
          RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
          REGION: this.region,
          TABLE_NAME: "DynamoDB-Conversation-Table",
          BEDROCK_LLM_PARAM: bedrockLLMParameter.parameterName,
          TABLE_NAME_PARAM: tableNameParameter.parameterName,
        },
      }
    );

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnSummaryDockerFunc = summaryLambdaDockerFunc.node
      .defaultChild as lambda.CfnFunction;
    cfnSummaryDockerFunc.overrideLogicalId("SummaryLambdaDockerFunc");

    // Add the permission to the Lambda function's policy to allow API Gateway access
    summaryLambdaDockerFunc.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });


    // Attach the corrected Bedrock policy to Lambda
    summaryLambdaDockerFunc.addToRolePolicy(bedrockPolicyStatement);

    // Grant access to Secret Manager
    summaryLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    summaryLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:GetItem"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/DynamoDB-Conversation-Table`,
        ],
      })
    );
    // Grant access to SSM Parameter Store for specific parameters
    summaryLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          bedrockLLMParameter.parameterArn,
          embeddingModelParameter.parameterArn,
          tableNameParameter.parameterArn,
        ],
      })
    );



    // Create S3 Bucket to handle documents for each simulation group
    const dataIngestionBucket = new s3.Bucket(this, `${id}-DataIngestionBucket`, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ["*"],
        },
      ],
      // When deleting the stack, need to empty the Bucket and delete it manually
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
    });

    // Create the Lambda function for generating presigned URLs
    const generatePreSignedURL = new lambda.Function(
      this,
      `${id}-GeneratePreSignedURLFunction`,
      {
        runtime: lambda.Runtime.PYTHON_3_9,
        code: lambda.Code.fromAsset("lambda/generatePreSignedURL"),
        handler: "generatePreSignedURL.lambda_handler",
        timeout: Duration.seconds(300),
        memorySize: 128,
        environment: {
          BUCKET: audioStorageBucket.bucketName,
          REGION: this.region,
        },
        functionName: `${id}-GeneratePreSignedURLFunction`,
        layers: [powertoolsLayer],
      }
    );

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnGeneratePreSignedURL = generatePreSignedURL.node
      .defaultChild as lambda.CfnFunction;
    cfnGeneratePreSignedURL.overrideLogicalId("GeneratePreSignedURLFunc");

    // Grant the Lambda function the necessary permissions
    audioStorageBucket.grantReadWrite(generatePreSignedURL);
    generatePreSignedURL.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject"],
        resources: [
          audioStorageBucket.bucketArn,
          `${audioStorageBucket.bucketArn}/*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    generatePreSignedURL.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    /**
     *
     * Create Lambda with container image for data ingestion workflow in RAG pipeline
     * This function will be triggered when a file in uploaded or deleted fro, the S3 Bucket
     */
    const dataIngestLambdaDockerFunc = new lambda.DockerImageFunction(
      this,
      `${id}-DataIngestLambdaDockerFunction`,
      {
        code: lambda.DockerImageCode.fromImageAsset("./data_ingestion"),
        memorySize: 2048,
        timeout: cdk.Duration.seconds(900),
        vpc: vpcStack.vpc, // Pass the VPC
        functionName: `${id}-DataIngestLambdaDockerFunction`,
        environment: {
          SM_DB_CREDENTIALS: db.secretPathAdminName,
          RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
          BUCKET: dataIngestionBucket.bucketName,
          REGION: this.region,
        },
      }
    );

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnDataIngestLambdaDockerFunc = dataIngestLambdaDockerFunc.node
      .defaultChild as lambda.CfnFunction;
    cfnDataIngestLambdaDockerFunc.overrideLogicalId(
      "DataIngestLambdaDockerFunc"
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    dataIngestLambdaDockerFunc.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    dataIngestLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:CreateGuardrail",
          "bedrock:CreateGuardrailVersion",
          "bedrock:DeleteGuardrail", // Permission to create guardrails
          "bedrock:ListGuardrails",  // (Optional) To list existing guardrails
          "bedrock:InvokeGuardrail",
          "bedrock:ApplyGuardrail"  // (Optional) To invoke the guardrail for filtering
        ],
        resources: ["*"], // Replace with specific resource ARNs if available
      })
    );

    // Attach the custom Bedrock policy to Lambda function
    dataIngestLambdaDockerFunc.addToRolePolicy(bedrockPolicyStatement);

    // Grant access to Secret Manager
    dataIngestLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Grant access to SSM Parameter Store for specific parameters
    dataIngestLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [embeddingModelParameter.parameterArn],
      })
    );

    // Get Log Group for dataIngestLambdaDockerFunc
    let logGroup: logs.ILogGroup;
    try {
      logGroup = logs.LogGroup.fromLogGroupName(
        this,
        `${id}-ExistingDataIngestLambdaLogGroup`,
        `/aws/lambda/${dataIngestLambdaDockerFunc.functionName}`
      );
    } catch {
      logGroup = new logs.LogGroup(this, `${id}-DataIngestLambdaLogGroup`, {
        logGroupName: `/aws/lambda/${dataIngestLambdaDockerFunc.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK, // Set retention policy
        removalPolicy: cdk.RemovalPolicy.DESTROY, // Adjust as needed
      });
    }




    /**
     *
     * Create Lambda function that will return all file names for a specified simulation group and patient
     */
    const getFilesFunction = new lambda.Function(this, `${id}-GetFilesFunction`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/getFilesFunction"),
      handler: "getFilesFunction.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        BUCKET: dataIngestionBucket.bucketName,
        REGION: this.region,
      },
      functionName: `${id}-GetFilesFunction`,
      layers: [psycopgLayer, powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnGetFilesFunction = getFilesFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnGetFilesFunction.overrideLogicalId("GetFilesFunction");

    // Grant the Lambda function read-only permissions to the S3 bucket
    dataIngestionBucket.grantRead(getFilesFunction);

    // Grant access to Secret Manager
    getFilesFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    getFilesFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor*`,
    });

    /**
     *
     * Create Lambda function that will return all file names for a specified simulation group and patient for a student
     */
    const getFilesFunctionStudent = new lambda.Function(this, `${id}-GetFilesFunctionStudent`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/getFilesFunction"),
      handler: "getFilesFunction.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        BUCKET: dataIngestionBucket.bucketName,
        REGION: this.region,
      },
      functionName: `${id}-GetFilesFunctionStudent`,
      layers: [psycopgLayer, powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnGetFilesFunctionStudent = getFilesFunctionStudent.node
      .defaultChild as lambda.CfnFunction;
    cfnGetFilesFunctionStudent.overrideLogicalId("GetFilesFunctionStudent");

    // Grant the Lambda function read-only permissions to the S3 bucket
    dataIngestionBucket.grantRead(getFilesFunctionStudent);

    // Grant access to Secret Manager
    getFilesFunctionStudent.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    getFilesFunctionStudent.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    /**
     *
     * Create Lambda function that will return profile pictures of all patients within a simulation group
     */
    const getProfilePictures = new lambda.Function(this, `${id}-GetProfilePictures`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/getProfilePictures"),
      handler: "getProfilePictures.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        BUCKET: dataIngestionBucket.bucketName,
        REGION: this.region,
      },
      functionName: `${id}-GetProfilePictures`,
      layers: [psycopgLayer, powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnGetProfilePictures = getProfilePictures.node
      .defaultChild as lambda.CfnFunction;
      cfnGetProfilePictures.overrideLogicalId("GetProfilePictures");

    // Grant the Lambda function read-only permissions to the S3 bucket
    dataIngestionBucket.grantRead(getProfilePictures);

    // Grant access to Secret Manager
    getProfilePictures.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    getProfilePictures.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor*`,
    });

    /**
     *
     * Create Lambda function that will return profile pictures of all patients within a simulation group for students
     */
    const getProfilePicturesStudent = new lambda.Function(this, `${id}-GetProfilePicturesStudent`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/getProfilePictures"),
      handler: "getProfilePictures.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        BUCKET: dataIngestionBucket.bucketName,
        REGION: this.region,
      },
      functionName: `${id}-GetProfilePicturesStudent`,
      layers: [psycopgLayer, powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnGetProfilePicturesStudent = getProfilePicturesStudent.node
      .defaultChild as lambda.CfnFunction;
      cfnGetProfilePicturesStudent.overrideLogicalId("GetProfilePicturesStudent");

    // Grant the Lambda function read-only permissions to the S3 bucket
    dataIngestionBucket.grantRead(getProfilePicturesStudent);

    // Grant access to Secret Manager
    getProfilePicturesStudent.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    getProfilePicturesStudent.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    /**
     *
     * Create Lambda function to delete certain file
     */
    const deleteFile = new lambda.Function(this, `${id}-DeleteFileFunction`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/deleteFile"),
      handler: "deleteFile.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName, // Database User Credentials
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint, // RDS Proxy Endpoint
        BUCKET: dataIngestionBucket.bucketName,
        REGION: this.region,
      },
      functionName: `${id}-DeleteFileFunction`,
      layers: [psycopgLayer, powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfndeleteFile = deleteFile.node.defaultChild as lambda.CfnFunction;
    cfndeleteFile.overrideLogicalId("DeleteFileFunc");

    // Grant the Lambda function the necessary permissions
    dataIngestionBucket.grantDelete(deleteFile);

    // Grant access to Secret Manager
    deleteFile.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    deleteFile.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor*`,
    });

    /**
     *
     * Create Lambda function to delete an entire patient directory
     */
    const deletePatientFunction = new lambda.Function(this, `${id}-DeletePatientFunction`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/deletePatient"),
      handler: "deletePatient.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      environment: {
        BUCKET: dataIngestionBucket.bucketName,
        REGION: this.region,
      },
      functionName: `${id}-DeletePatientFunction`,
      layers: [powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnDeletePatientFunction = deletePatientFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnDeletePatientFunction.overrideLogicalId("DeletePatientFunc");

    // Grant the Lambda function the necessary permissions
    dataIngestionBucket.grantRead(deletePatientFunction);
    dataIngestionBucket.grantDelete(deletePatientFunction);

    // Add the permission to the Lambda function's policy to allow API Gateway access
    deletePatientFunction.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/instructor*`,
    });

    /**
     *
     * Create a Lambda function that deletes the last message in a conversation
     */
    const deleteLastMessage = new lambda.Function(this, `${id}-DeleteLastMessage`, {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("lambda/deleteLastMessage"),
      handler: "deleteLastMessage.lambda_handler",
      timeout: Duration.seconds(300),
      memorySize: 128,
      vpc: vpcStack.vpc,
      environment: {
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        TABLE_NAME_PARAM: tableNameParameter.parameterName,
        REGION: this.region,
      },
      functionName: `${id}-DeleteLastMessage`,
      layers: [psycopgLayer, powertoolsLayer],
    });

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnDeleteLastMessage = deleteLastMessage.node
      .defaultChild as lambda.CfnFunction;
    cfnDeleteLastMessage.overrideLogicalId("DeleteLastMessage");

    // Grant access to Secret Manager
    deleteLastMessage.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          //Secrets Manager
          "secretsmanager:GetSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    // Grant the Lambda function necessary permissions to access DynamoDB
    deleteLastMessage.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/*`],
      })
    );

    // Add the permission to the Lambda function's policy to allow API Gateway access
    deleteLastMessage.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });

    // Grant access to SSM Parameter Store for specific parameters
    deleteLastMessage.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          tableNameParameter.parameterArn,
        ],
      })
    );

    // Waf Firewall
    const waf = new wafv2.CfnWebACL(this, `${id}-waf`, {
      description: "LAT waf with OWASP",
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "legalaidtool-firewall",
      },
      rules: [
        {
          name: "AWSManagedRulesSQLiRuleSet",
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesSQLiRuleSet",
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesSQLiRuleSet",
          },
        },
        {
          name: "AWS-AWSManagedRulesCommonRuleSet",
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWS-AWSManagedRulesCommonRuleSet",
          },
        },
        {
          name: "AWSManagedRulesPHPRuleSet",
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesPHPRuleSet",
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesPHPRuleSet",
          },
        },
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 4,
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesKnownBadInputsRuleSet",
          },
        },
        {
          name: "LimitRequests1000",
          priority: 5,
          action: {
            block: {},
          },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "LimitRequests1000",
          },
        },
      ],
    });
    const wafAssociation = new wafv2.CfnWebACLAssociation(
      this,
      `${id}-waf-association`,
      {
        resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${this.api.restApiId}/stages/${this.api.deploymentStage.stageName}`,
        webAclArn: waf.attrArn,
      }
    );

  }
}
