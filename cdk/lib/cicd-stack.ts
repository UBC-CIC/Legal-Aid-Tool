import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Source } from "aws-cdk-lib/aws-codebuild";


interface LambdaConfig {
  name: string;           // Module name (e.g., "textGeneration")
  functionName: string;   // Lambda function name
  sourceDir: string;      // Source directory for Docker build
}

interface CICDStackProps extends cdk.StackProps {
  githubRepo: string;
  githubBranch?: string;
  environmentName?: string;
  lambdaFunctions: LambdaConfig[];
}

export class CICDStack extends cdk.Stack {
  public readonly ecrRepositories: { [key: string]: ecr.Repository } = {};
  
  public createDockerLambdaFunction(
  id: string,
  functionName: string,
  repoName: string,
  vpc: ec2.IVpc,
  environment: { [key: string]: string },
  role: iam.IRole,
  logicalId?: string // Add this parameter
): lambda.DockerImageFunction {
  
  const lambdaFunction = new lambda.DockerImageFunction(this, id, {
    code: lambda.DockerImageCode.fromEcr(
      this.ecrRepositories[repoName],
      {
        tagOrDigest: `${repoName}-dev-latest`
      }
    ),
    functionName: functionName,
    vpc: vpc,
    environment: environment,
    role: role,
    timeout: cdk.Duration.seconds(300),
    memorySize: 2048,
  });
  
  // Set logical ID if provided
  if (logicalId) {
    const cfnFunction = lambdaFunction.node.defaultChild as lambda.CfnFunction;
    cfnFunction.overrideLogicalId(logicalId);
  }
  
  return lambdaFunction;
}



  constructor(scope: Construct, id: string, props: CICDStackProps) {
    super(scope, id, props);

    const envName = props.environmentName ?? "dev";

    // Create a common role for all CodeBuild projects
    const codeBuildRole = new iam.Role(this, "DockerBuildRole", {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    });

    codeBuildRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryPowerUser")
    );

    codeBuildRole.addToPolicy(new iam.PolicyStatement({
  actions: ['lambda:UpdateFunctionCode'],
  resources: [
    `arn:aws:lambda:${this.region}:${this.account}:function:*`, // or specify per function
  ],
}));


    // Create artifacts for pipeline
    const sourceOutput = new codepipeline.Artifact();

    // Create the pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DockerImagePipeline', {
      pipelineName: `${id}-DockerImagePipeline`,
    });

    const username = cdk.aws_ssm.StringParameter.valueForStringParameter(
          this,
          "lat-owner-name"
        );

    // Add source stage
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.GitHubSourceAction({
          actionName: 'GitHub',
          owner: username,
          repo: props.githubRepo,
          branch: props.githubBranch ?? 'main',
          oauthToken: cdk.SecretValue.secretsManager('github-personal-access-token', {
            jsonField: 'my-github-token',
          }),
          output: sourceOutput,
        }),
      ],
    });

    // Create build actions for each Lambda function
    const buildActions: codepipeline_actions.CodeBuildAction[] = [];

    props.lambdaFunctions.forEach(lambda => {
      // Create ECR repository
      const repoName = `${id.toLowerCase()}-${lambda.name.toLowerCase()}`;
      const ecrRepo = new ecr.Repository(this, `${lambda.name}Repo`, {
        repositoryName: repoName,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        imageScanOnPush: true,
      });

      ecrRepo.addToResourcePolicy(new iam.PolicyStatement({
  sid: "LambdaPullAccess",
  effect: iam.Effect.ALLOW,
  principals: [new iam.ServicePrincipal("lambda.amazonaws.com")],
  actions: [
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
    "ecr:BatchCheckLayerAvailability",
  ],
  conditions: {
    StringEquals: {
      "aws:SourceAccount": this.account,
    }
  }
}));


      
      this.ecrRepositories[lambda.name] = ecrRepo;
      cdk.Tags.of(ecrRepo).add("module", lambda.name);
      cdk.Tags.of(ecrRepo).add("env", envName);


      // Create CodeBuild project
      const buildProject = new codebuild.PipelineProject(this, `${lambda.name}BuildProject`, {
        projectName: `${id}-${lambda.name}Builder`,
        role: codeBuildRole,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          privileged: true,
        },
        environmentVariables: {
          AWS_ACCOUNT_ID: { value: this.account },
          AWS_REGION: { value: this.region },
          ENVIRONMENT: { value: envName },
          MODULE_NAME: { value: lambda.name },
          LAMBDA_FUNCTION_NAME: { value: lambda.functionName },
          REPO_NAME: { value: repoName },
          REPOSITORY_URI: { value: ecrRepo.repositoryUri }
        },
        buildSpec: codebuild.BuildSpec.fromObject({
  version: '0.2',
  phases: {
    pre_build: {
      commands: [
        'echo Logging in to Amazon ECR...',
        'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com',
        'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
        'IMAGE_TAG=${MODULE_NAME}-${ENVIRONMENT}-${COMMIT_HASH}',
        'export DOCKER_HOST=unix:///var/run/docker.sock'
      ]
    },
    build: {
      commands: [
        'echo "Building Docker image..."',
        'docker build -t $REPOSITORY_URI:$IMAGE_TAG $CODEBUILD_SRC_DIR/' + lambda.sourceDir + ' -f $CODEBUILD_SRC_DIR/' + lambda.sourceDir + '/Dockerfile'
      ]
    },
    post_build: {
      commands: [
        'docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest',
        'docker push $REPOSITORY_URI:$IMAGE_TAG',
    'docker push $REPOSITORY_URI:latest',
    'echo Updating Lambda function...',
      ]
    }
  }
})
      });

      // Grant permissions to push to ECR
      ecrRepo.grantPullPush(buildProject);

      // Add build action to the list
      buildActions.push(
        new codepipeline_actions.CodeBuildAction({
          actionName: `Build_${lambda.name}`,
          project: buildProject,
          input: sourceOutput
        })
      );
    });

    // Add build stage with all build actions
    pipeline.addStage({
      stageName: 'Build',
      actions: buildActions,
    });
  }
}
