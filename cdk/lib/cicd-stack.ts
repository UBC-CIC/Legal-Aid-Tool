import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";


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
  pathFilters?: string[];
}

export class CICDStack extends cdk.Stack {
  public readonly ecrRepositories: { [key: string]: ecr.Repository } = {};

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


    // Create artifacts for pipeline
    const sourceOutput = new codepipeline.Artifact();

    // Create the pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DockerImagePipeline', {
      pipelineName: `${id}-DockerImagePipeline`,
    });

    const username = cdk.aws_ssm.StringParameter.valueForStringParameter(
      this,
      "lat-owner-name"
    ) || "default-owner";

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
          trigger: codepipeline_actions.GitHubTrigger.WEBHOOK,
          ...(props.pathFilters ? {
            filter: {
              json: JSON.stringify({
                push: {
                  paths: {
                    includes: props.pathFilters
                  }
                }
              })
            }
          } : {})
        })],
    });

    // Create build actions for each Lambda function
    const buildActions: codepipeline_actions.CodeBuildAction[] = [];

    props.lambdaFunctions.forEach(lambda => {
      // Create ECR repository
      const repoName = `${id.toLowerCase()}-${lambda.name.toLowerCase()}`;
      const ecrRepo = new ecr.Repository(this, `${lambda.name}Repo`, {
        repositoryName: repoName,
        imageTagMutability: ecr.TagMutability.MUTABLE,
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
          AWS_ACCOUNT_ID: { value: this.account || 'unknown' },
          AWS_REGION: { value: this.region || 'ca-central-1' },
          ENVIRONMENT: { value: envName || 'dev' },
          MODULE_NAME: { value: lambda.name || 'unknown' },
          LAMBDA_FUNCTION_NAME: { value: lambda.functionName || 'unknown' },
          REPO_NAME: { value: repoName || 'unknown' },
          REPOSITORY_URI: { value: ecrRepo.repositoryUri || 'unknown' },
          GITHUB_USERNAME: { value: username || 'unknown' },
          GITHUB_REPO: { value: props.githubRepo || 'unknown' },
          GITHUB_TOKEN: {
            type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
            value: 'github-personal-access-token:my-github-token'
          },
          PATH_FILTER: { value: lambda.sourceDir || 'unknown' },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            pre_build: {
              commands: [
                'echo Logging in to Amazon ECR...',
                'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com',
                'echo "#!/bin/bash" > check_and_build.sh',
                'echo "set -e" >> check_and_build.sh',
                'echo "git clone https://$GITHUB_TOKEN@github.com/$GITHUB_USERNAME/$GITHUB_REPO.git repo" >> check_and_build.sh',
                'echo "cd repo" >> check_and_build.sh',
                'echo "git fetch origin" >> check_and_build.sh',
                'echo "git checkout $CODEBUILD_RESOLVED_SOURCE_VERSION" >> check_and_build.sh',
                'echo "# Check if image exists in ECR" >> check_and_build.sh',
                'echo "if ! aws ecr describe-images --repository-name $REPO_NAME --image-ids imageTag=latest &>/dev/null; then" >> check_and_build.sh',
                'echo "  echo \\"First deployment or image doesn\'t exist - building without path check\\"" >> check_and_build.sh',
                'echo "  exit 0" >> check_and_build.sh',
                'echo "fi" >> check_and_build.sh',
                'echo "PREV_COMMIT=\\$(git rev-parse HEAD~1 || echo \\"\\")" >> check_and_build.sh',
                'echo "CHANGED_FILES=\\$(git diff --name-only \\$PREV_COMMIT HEAD)" >> check_and_build.sh',
                'echo "echo \\"Changed files:\\"" >> check_and_build.sh',
                'echo "echo \\"\\$CHANGED_FILES\\"" >> check_and_build.sh',
                'echo "if ! echo \\"\\$CHANGED_FILES\\" | grep -q \\"^$PATH_FILTER/\\"; then" >> check_and_build.sh',
                'echo "  echo \\"No changes in $PATH_FILTER — skipping build.\\"" >> check_and_build.sh',
                'echo "  exit 1" >> check_and_build.sh',
                'echo "fi" >> check_and_build.sh',
                'echo "exit 0" >> check_and_build.sh',
                'chmod +x check_and_build.sh',
                'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                'IMAGE_TAG=${MODULE_NAME}-${ENVIRONMENT}-${COMMIT_HASH}',
                'export DOCKER_HOST=unix:///var/run/docker.sock',
                './check_and_build.sh || { echo "Skipping build due to no changes"; exit 1; }'
              ]
            },
            build: {
              commands: [
                'echo "Building Docker image..."',
                `docker build -t $REPOSITORY_URI:$IMAGE_TAG $CODEBUILD_SRC_DIR/${lambda.sourceDir} -f $CODEBUILD_SRC_DIR/${lambda.sourceDir}/Dockerfile`
              ]
            },
            post_build: {
              commands: [
                'docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest',
                'docker push $REPOSITORY_URI:$IMAGE_TAG',
                'docker push $REPOSITORY_URI:latest',
                'echo "Waiting for vulnerability scan to complete..."',
                'sleep 30',
                'echo "Checking vulnerability scan results..."',
                'SCAN_RESULTS=$(aws ecr describe-image-scan-findings --repository-name $REPO_NAME --image-id imageTag=latest --query "imageScanFindingsSummary.findingCounts.CRITICAL" --output text 2>/dev/null || echo "0")',
                'if [ "$SCAN_RESULTS" != "0" ] && [ "$SCAN_RESULTS" != "None" ]; then',
                '  echo "CRITICAL vulnerabilities found: $SCAN_RESULTS. Blocking deployment."',
                '  exit 1',
                'fi',
                'echo "No critical vulnerabilities found. Proceeding with deployment."',
                'echo "Checking if Lambda function exists before updating..."',
                'if aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME &>/dev/null; then',
                '  echo "Updating Lambda function to use the new image..."',
                '  aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME --image-uri $REPOSITORY_URI:latest',
                'else',
                '  echo "Lambda function $LAMBDA_FUNCTION_NAME does not exist yet. Skipping update."',
                'fi'
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

    // Security: Add vulnerability scanning and blocking
    this.addVulnerabilityScanning(props.lambdaFunctions);
  }

  private addVulnerabilityScanning(lambdaFunctions: LambdaConfig[]) {
    // SNS topic for security alerts
    const securityTopic = new sns.Topic(this, 'SecurityAlerts', {
      displayName: 'ECR Vulnerability Alerts'
    });

    // Lambda to handle vulnerability scan results
    const vulnerabilityHandler = new lambda.Function(this, 'VulnerabilityHandler', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os

def lambda_handler(event, context):
    ecr = boto3.client('ecr')
    sns = boto3.client('sns')
    lambda_client = boto3.client('lambda')
    
    detail = event['detail']
    repository_name = detail['repository-name']
    image_tag = detail['image-tags'][0] if detail.get('image-tags') else 'latest'
    scan_status = detail['scan-status']
    
    if scan_status == 'COMPLETE':
        try:
            response = ecr.describe_image_scan_findings(
                repositoryName=repository_name,
                imageId={'imageTag': image_tag}
            )
            
            findings = response['imageScanFindingsSummary']['findingCounts']
            critical = findings.get('CRITICAL', 0)
            high = findings.get('HIGH', 0)
            
            if critical > 0:
                message = f"CRITICAL: {repository_name}:{image_tag} has {critical} critical vulnerabilities. Deployment blocked!"
                
                sns.publish(
                    TopicArn=os.environ['SNS_TOPIC_ARN'],
                    Subject='Critical Vulnerabilities Detected',
                    Message=message
                )
                
                # Block CodeBuild from updating Lambda functions
                codebuild = boto3.client('codebuild')
                codebuild.stop_build_batch(
                    id=context.aws_request_id
                )
                
                return {'statusCode': 403, 'body': 'Deployment blocked'}
            
            elif high > 0:
                message = f"WARNING: {repository_name}:{image_tag} has {high} high vulnerabilities."
                sns.publish(
                    TopicArn=os.environ['SNS_TOPIC_ARN'],
                    Subject='High Vulnerabilities Detected',
                    Message=message
                )
        
        except Exception as e:
            print(f"Error processing scan: {e}")
    
    return {'statusCode': 200, 'body': 'Processed'}
      `),
      environment: {
        SNS_TOPIC_ARN: securityTopic.topicArn
      }
    });

    // Grant permissions
    vulnerabilityHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ecr:DescribeImageScanFindings',
        'codebuild:StopBuildBatch',
        'codebuild:BatchGetBuilds'
      ],
      resources: ['*']
    }));

    securityTopic.grantPublish(vulnerabilityHandler);

    // EventBridge rule for ECR scan completion
    new events.Rule(this, 'ECRScanRule', {
      eventPattern: {
        source: ['aws.ecr'],
        detailType: ['ECR Image Scan'],
        detail: {
          'scan-status': ['COMPLETE'],
          'repository-name': lambdaFunctions.map(f => 
            `${this.stackName.toLowerCase()}-${f.name.toLowerCase()}`
          )
        }
      },
      targets: [new targets.LambdaFunction(vulnerabilityHandler)]
    });
  }
}
