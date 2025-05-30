#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AmplifyStack } from '../lib/amplify-stack';
import { ApiGatewayStack } from '../lib/api-gateway-stack';
import { DatabaseStack } from '../lib/database-stack';
import { DBFlowStack } from '../lib/dbFlow-stack';
import { VpcStack } from '../lib/vpc-stack';
import {CICDStack} from '../lib/cicd-stack'
import { AwsSolutionsChecks } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';
const app = new cdk.App();
// Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true })); // Uncomment this line to enable AWS Solutions checks

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

const StackPrefix = app.node.tryGetContext("StackPrefix");
const environment = app.node.tryGetContext("environmentName");
const version = app.node.tryGetContext("versionNumber");
const githubRepo = app.node.tryGetContext("githubRepo");


const vpcStack = new VpcStack(app, `${StackPrefix}-VpcStack`, { env, stackPrefix: StackPrefix, });
const dbStack = new DatabaseStack(app, `${StackPrefix}-Database`, vpcStack, { env });
const cicdStack = new CICDStack(app, `${StackPrefix}-CICD`, {
  env,
  githubRepo: githubRepo,
  environmentName: environment,
  lambdaFunctions: [
    {
      name: 'textGeneration',
      functionName: `${StackPrefix}-Api-TextGenLambdaDockerFunction`,
      sourceDir: 'cdk/lambda/text_generation'
    },
    {
      name: 'audioToText',
      functionName: `${StackPrefix}-Api-audioToTextFun`,
      sourceDir: 'cdk/lambda/audioToText'
    },
    {
      name: 'caseGeneration',
      functionName: `${StackPrefix}-Api-CaseLambdaDockerFunction`,
      sourceDir:'cdk/lambda/case_generation'
    },
    {
      name: 'summaryGeneration',
      functionName: `${StackPrefix}-Api-SummaryLambdaDockerFunction`,
      sourceDir: 'cdk/lambda/summary_generation'
    }
  ]
});

const apiStack = new ApiGatewayStack(app, `${StackPrefix}-Api`, dbStack, vpcStack, { 
  env, 
  ecrRepositories: cicdStack.ecrRepositories,  
});

const dbFlowStack = new DBFlowStack(app, `${StackPrefix}-DBFlow`, vpcStack, dbStack, apiStack, { env });
const amplifyStack = new AmplifyStack(app, `${StackPrefix}-Amplify`, apiStack, { env });
cdk.Tags.of(app).add("app", "Legal-Aid-Tool");