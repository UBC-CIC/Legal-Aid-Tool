import { Stack, StackProps, triggers } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

// Service files import
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

// Stack import
import { VpcStack } from './vpc-stack';
import { DatabaseStack } from './database-stack';
import { ApiGatewayStack } from './api-gateway-stack';

export class DBFlowStack extends Stack {
    constructor(scope: Construct, id: string, vpcStack: VpcStack, db: DatabaseStack, apiStack: ApiGatewayStack, props?: StackProps) {
        super(scope, id, props);

        // Retrieve the psycopg2 layer from the API stack
        const psycopgLambdaLayer = apiStack.getLayers()['psycopg2'];

        // Create IAM role for Lambda within the VPC
        const lambdaRole = new iam.Role(this, `${id}-lambda-vpc-role`, {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            description: "Role for all Lambda functions inside VPC",
        });

        // Add necessary policies to the Lambda role
        lambdaRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    // Secrets Manager
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:PutSecretValue"
                ],
                resources: [
                    `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
                ],
            })
        );

        lambdaRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    // CloudWatch Logs
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources: ["arn:aws:logs:*:*:*"],
            })
        );

        lambdaRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "ec2:CreateNetworkInterface",
                    "ec2:DeleteNetworkInterface",
                    "ec2:DescribeNetworkInterfaces",
                ],
                resources: ["*"],
            })
        );

        // Add additional managed policies
        lambdaRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess")
        );

        lambdaRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
        );

        // Create an initializer Lambda function for the RDS instance, invoked only during deployment
        const initializerLambda = new triggers.TriggerFunction(this, `${id}-triggerLambda`, {
            functionName: `${id}-initializerFunction`,
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: "initializer.handler",
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                DB_SECRET_NAME: db.secretPathAdminName,     // Admin Secret Manager name
                DB_USER_SECRET_NAME: db.secretPathUser.secretName, // User Secret Manager name
                DB_PROXY: db.secretPathTableCreator.secretName, // Proxy Secret
            },
            vpc: db.dbInstance.vpc,
            code: lambda.Code.fromAsset("lambda/initializer"),
            layers: [psycopgLambdaLayer],
            role: lambdaRole,
        });
    }
}