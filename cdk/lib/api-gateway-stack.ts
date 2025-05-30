import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as appsync from "aws-cdk-lib/aws-appsync";
import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import {
  Code,
  LayerVersion,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { VpcStack } from "./vpc-stack";
import { DatabaseStack } from "./database-stack";
import { Fn } from "aws-cdk-lib";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
// At the top of your file with other imports
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Stack, StackProps } from "aws-cdk-lib";

interface ApiGatewayStackProps extends cdk.StackProps {
  ecrRepositories: { [key: string]: ecr.Repository };
}

export class ApiGatewayStack extends cdk.Stack {
  private readonly api: apigateway.SpecRestApi;
  public readonly appClient: cognito.UserPoolClient;
  public readonly userPool: cognito.UserPool;
  public readonly identityPool: cognito.CfnIdentityPool;
  private readonly layerList: { [key: string]: LayerVersion };
  public readonly stageARN_APIGW: string;
  public readonly apiGW_basedURL: string;
  private eventApi: appsync.GraphqlApi;
  public readonly secret: secretsmanager.ISecret;
  public getEndpointUrl = () => this.api.url;
  public getUserPoolId = () => this.userPool.userPoolId;
  public getEventApiUrl = () => this.eventApi.graphqlUrl;
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
    props: ApiGatewayStackProps
  ) {
    super(scope, id, props);

    this.layerList = {};

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
        // When deleting the stack, the bucket will be deleted as well
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        enforceSSL: true,
      }
    );
    
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
        emailSubject: "Legal Aid Tool - Confirmation Code",
        emailBody:
          `
              <html>
      <head>
        <style>
          body {
            font-family: Outfit, sans-serif;
            background-color: #F5F5F5;
            color: #111835;
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
            border: 1px solid #ddd;
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
            background-color: #111835;
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
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap" rel="stylesheet">
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>Legal Aid Tool</h1>
            <!--<img src="" alt="Legal Aid Tool Logo" width="150" height="auto"/>-->
          </div>
          <div class="main-content">
            <p>Thank you for signing up for Legal Aid Tool!</p>
            <p>Verify your email by using the code below:</p>
            <div class="code">{####}</div>
            <p>If you did not request this verification, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>Please do not reply to this email.</p>
            <p>Legal Aid Tool, 2025</p>
          </div>
        </div>
      </body>
    </html>
          `,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
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

    const accessLogGroup = new logs.LogGroup(this, `${id}-ApiAccessLogs`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create the API Gateway REST API
    this.api = new apigateway.SpecRestApi(this, `${id}-APIGateway`, {
      apiDefinition: apigateway.AssetApiDefinition.fromInline(data),
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      restApiName: `${id}-API`,
      deploy: true,
      cloudWatchRole: true,
      deployOptions: {
        stageName: "prod",
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
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


    // Create SSM parameter for message limit
    const messageLimitParameter = new ssm.StringParameter(this, "MessageLimitParameter", {
      parameterName: `/${id}/LAT/MessageLimit`,
      description: "Parameter containing the Message Limit for the AI assistant (per day)",
      stringValue: "Infinity",
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
        MESSAGE_LIMIT: messageLimitParameter.parameterName,
      },
      functionName: `${id}-studentFunction`,
      memorySize: 512,
      layers: [postgres],
      role: lambdaRole,
    });

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

    lambdaStudentFunction.addPermission("AllowTestInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/test-invoke-stage/*/*`,
    });

    // Add permission to the Lambda function to allow it to access the message limit parameter
    messageLimitParameter.grantRead(lambdaStudentFunction);

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
        MESSAGE_LIMIT: messageLimitParameter.parameterName,
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

    // Allow access for lambda to read and write to message limit parameter
    messageLimitParameter.grantWrite(lambdaAdminFunction);

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

    this.eventApi = new appsync.GraphqlApi(this, `${id}-EventApi`, {
      name: `${id}-EventApi`,
      definition: appsync.Definition.fromFile("./graphql/schema.graphql"),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: this.userPool,
            defaultAction: appsync.UserPoolDefaultAction.ALLOW
          }
        }
        // No additional authorization modes needed
      },
      xrayEnabled: true,
    });


    const notificationFunction = new lambda.Function(
      this,
      `${id}-NotificationFunction`,
      {
        runtime: lambda.Runtime.PYTHON_3_9,
        code: lambda.Code.fromAsset("lambda/eventNotification"),
        handler: "eventNotification.lambda_handler",
        environment: {
          APPSYNC_API_URL: this.eventApi.graphqlUrl,
          APPSYNC_API_ID: this.eventApi.apiId,
          REGION: this.region,
        },
        functionName: `${id}-NotificationFunction`,
        timeout: cdk.Duration.seconds(300),
        memorySize: 128,
        vpc: vpcStack.vpc,
        role: lambdaRole,
      }
    );

    notificationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["appsync:GraphQL"],
        resources: [
          `arn:aws:appsync:${this.region}:${this.account}:apis/${this.eventApi.apiId}/*`,
        ],
      })
    );

    notificationFunction.addPermission("AppSyncInvokePermission", {
      principal: new iam.ServicePrincipal("appsync.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:appsync:${this.region}:${this.account}:apis/${this.eventApi.apiId}/*`,
    });


    const notificationLambdaDataSource = this.eventApi.addLambdaDataSource(
      "NotificationLambdaDataSource",
      notificationFunction
    );

    notificationLambdaDataSource.createResolver("ResolverEventApi", {
      typeName: "Mutation",
      fieldName: "sendNotification",
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });
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

    const audioToTextFunction = new lambda.DockerImageFunction(
  this,
  `${id}-audioToTextFunc`,
  {
    code: lambda.DockerImageCode.fromEcr(
      props.ecrRepositories["audioToText"], 
      {
        tagOrDigest: "latest",      // or whatever tag you're using
      }
    ),
    memorySize: 512,
    timeout: cdk.Duration.seconds(300),
    vpc: vpcStack.vpc,
    functionName: `${id}-audioToTextFunc`,
    environment: {
      SAUDIO_BUCKET: audioStorageBucket.bucketName,
        SM_DB_CREDENTIALS: db.secretPathUser.secretName,
        RDS_PROXY_ENDPOINT: db.rdsProxyEndpoint,
        APPSYNC_API_URL: this.eventApi.graphqlUrl,
        REGION: this.region,
    },
  }
);


    // textToLlmQueue.grantSendMessages(audioToTextFunction);

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnAudioToTextFunction = audioToTextFunction.node
      .defaultChild as lambda.CfnFunction;
    cfnAudioToTextFunction.overrideLogicalId("audioToTextFunction");
    // audioToTextQueue.grantConsumeMessages(audioToTextFunction);
    // Grant the Lambda function read-only permissions to the S3 bucket
    audioStorageBucket.grantRead(audioToTextFunction);

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
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
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

    // const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this.api, 'latAuthorizer', {
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

    // Create Lambda with container image for text generation workflow in RAG pipeline
const textGenLambdaDockerFunc = new lambda.DockerImageFunction(
  this,
  `${id}-TextGenLambdaDockerFunction`,
  {
    code: lambda.DockerImageCode.fromEcr(
      props.ecrRepositories["textGeneration"], 
      {
        tagOrDigest: "latest",      // or whatever tag you're using
      }
    ),
    memorySize: 512,
    timeout: cdk.Duration.seconds(300),
    vpc: vpcStack.vpc,
    functionName: `${id}-TextGenLambdaDockerFunction`,
    environment: {
      SM_DB_CREDENTIALS: db.secretPathAdminName,
      RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
      REGION: this.region,
      BEDROCK_LLM_PARAM: bedrockLLMParameter.parameterName,
      EMBEDDING_MODEL_PARAM: embeddingModelParameter.parameterName,
      TABLE_NAME_PARAM: tableNameParameter.parameterName,
      TABLE_NAME: "DynamoDB-Conversation-Table",
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


    textGenLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:CreateGuardrail",
          "bedrock:CreateGuardrailVersion",
          "bedrock:DeleteGuardrail", 
          "bedrock:ListGuardrails", 
          "bedrock:InvokeGuardrail",
          "bedrock:ApplyGuardrail"  
        ],
        resources: ["*"], 
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



    const caseGenLambdaDockerFunc = new lambda.DockerImageFunction(
  this,
  `${id}-CaseLambdaDockerFunction`,
  {
   code: lambda.DockerImageCode.fromEcr(
      props.ecrRepositories["caseGeneration"], 
      {
        tagOrDigest: "latest",      // or whatever tag you're using
      }
    ),
    memorySize: 512,
    timeout: cdk.Duration.seconds(300),
    vpc: vpcStack.vpc,
    functionName: `${id}-CaseLambdaDockerFunction`,
    environment: {
      SM_DB_CREDENTIALS: db.secretPathAdminName,
      RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
      REGION: this.region,
      BEDROCK_LLM_PARAM: bedrockLLMParameter.parameterName,
      EMBEDDING_MODEL_PARAM: embeddingModelParameter.parameterName,
      TABLE_NAME_PARAM: tableNameParameter.parameterName,
      TABLE_NAME: "DynamoDB-Conversation-Table",
    },
  }
);

    // Override the Logical ID of the Lambda Function to get ARN in OpenAPI
    const cfnCaseGenDockerFunc = caseGenLambdaDockerFunc.node
      .defaultChild as lambda.CfnFunction;
    cfnCaseGenDockerFunc.overrideLogicalId("CaseGenLambdaDockerFunc");

    // Add the permission to the Lambda function's policy to allow API Gateway access
    caseGenLambdaDockerFunc.addPermission("AllowApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.api.restApiId}/*/*/student*`,
    });


    // Attach the corrected Bedrock policy to Lambda
    caseGenLambdaDockerFunc.addToRolePolicy(bedrockPolicyStatement);

    caseGenLambdaDockerFunc.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:CreateGuardrail",
          "bedrock:CreateGuardrailVersion",
          "bedrock:DeleteGuardrail", 
          "bedrock:ListGuardrails",
          "bedrock:InvokeGuardrail",
          "bedrock:ApplyGuardrail"
        ],
        resources: ["*"],
      })
    );

    // Grant access to Secret Manager
    caseGenLambdaDockerFunc.addToRolePolicy(
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
       caseGenLambdaDockerFunc.addToRolePolicy(
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
    code: lambda.DockerImageCode.fromEcr(
      props.ecrRepositories["summaryGeneration"], 
      {
        tagOrDigest: "latest",      // or whatever tag you're using
      }
    ),
    memorySize: 512,
    timeout: cdk.Duration.seconds(300),
    vpc: vpcStack.vpc,
    functionName: `${id}-SummaryLambdaDockerFunction`,
    environment: {
      SM_DB_CREDENTIALS: db.secretPathAdminName,
      RDS_PROXY_ENDPOINT: db.rdsProxyEndpointAdmin,
      REGION: this.region,
      BEDROCK_LLM_PARAM: bedrockLLMParameter.parameterName,
      EMBEDDING_MODEL_PARAM: embeddingModelParameter.parameterName,
      TABLE_NAME_PARAM: tableNameParameter.parameterName,
      TABLE_NAME: "DynamoDB-Conversation-Table",
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



    // Get Log Group for dataIngestLambdaDockerFunc
    // let logGroup: logs.ILogGroup;
    // try {
    //   logGroup = logs.LogGroup.fromLogGroupName(
    //     this,
    //     `${id}-ExistingDataIngestLambdaLogGroup`,
    //     `/aws/lambda/${dataIngestLambdaDockerFunc.functionName}`
    //   );
    // } catch {
    //   logGroup = new logs.LogGroup(this, `${id}-DataIngestLambdaLogGroup`, {
    //     logGroupName: `/aws/lambda/${dataIngestLambdaDockerFunc.functionName}`,
    //     retention: logs.RetentionDays.ONE_WEEK, // Set retention policy
    //     removalPolicy: cdk.RemovalPolicy.DESTROY, // Adjust as needed
    //   });
    // }

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