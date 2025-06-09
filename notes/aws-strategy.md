CloudFormation is **perfect** for encoding and provisioning all of the AWS resources you need—S3 bucket, IAM roles, instance profile, EC2 (with user-data that runs your job and uploads to S3)—in a single, version-controlled YAML template. Then you simply ship that template and a tiny wrapper script that:

1. **`aws cloudformation deploy`** your stack
2. **poll** the S3 bucket until your job’s output appears
3. **`aws s3 cp`** it down
4. **`aws cloudformation delete-stack`**

—so your users never touch the console or think about infra.

---

### ✏️ What goes in the CloudFormation template

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: >
  Programmatic EC2 job runner with dynamic instance type selection
  based on required enclave RAM.

Parameters:
  BucketName:
    Type: String
    Description: "S3 bucket for job outputs"
  AmiId:
    Type: AWS::EC2::Image::Id
    Description: "Enclave-capable Amazon Linux AMI ID"
  RequiredMemoryGiB:
    Type: Number
    Description: "RAM required for Nitro Enclave (GiB)"

Mappings:
  MemoryToInstance:
    "8":
      InstanceType: c6a.large
    "16":
      InstanceType: m6a.large
    "32":
      InstanceType: m6a.xlarge
    "64":
      InstanceType: m6a.2xlarge
    "128":
      InstanceType: m6a.4xlarge

Resources:

  JobBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Ref BucketName

  JobRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: ec2.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
      Policies:
        - PolicyName: PutOnlyResults
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action: s3:PutObject
                Resource: !Sub arn:aws:s3:::${BucketName}/jobs/*

  JobInstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles:
        - !Ref JobRole

  JobInstance:
    Type: AWS::EC2::Instance
    Properties:
      InstanceType: !FindInMap
        - MemoryToInstance
        - !Sub "${RequiredMemoryGiB}"
        - InstanceType
      ImageId: !Ref AmiId
      IamInstanceProfile: !Ref JobInstanceProfile
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          set -e
          JOB_ID=$(uuidgen)
          # replace with your actual compute/enclave commands
          dd if=/dev/urandom of=/tmp/output.bin bs=1M count=50
          aws s3 cp /tmp/output.bin s3://${BucketName}/jobs/${JOB_ID}/output.bin
          TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
                     -H "X-aws-ec2-metadata-token-ttl-seconds:300")
          IID=$(curl -s -H "X-aws-ec2-metadata-token:$TOKEN" \
                     http://169.254.169.254/latest/meta-data/instance-id)
          aws ec2 terminate-instances --instance-ids "$IID" --region ${AWS::Region}

Outputs:
  BucketName:
    Description: "S3 bucket name"
    Value: !Ref BucketName
  InstanceId:
    Description: "EC2 instance ID"
    Value: !Ref JobInstance
```

---

### ✨ The “driver” script

```
npm install @aws-sdk/client-cloudformation @aws-sdk/client-s3
ts-node run.ts <RequiredMemoryGiB> <BucketName> <AmiId>
```

driver.ts:
```typescript
#!/usr/bin/env ts-node
/**
 * driver.ts - Driver script for launching a CloudFormation stack, polling S3 for output,
 * downloading the result, and tearing down the stack.
 *
 * AWS Credentials (for .env file) & Required Permissions
 * -------------------------------------------------------
 * This script uses your local AWS credentials supplied via environment variables
 * (e.g., in a .env file loaded with `dotenv`):
 *
 *   AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
 *   AWS_SESSION_TOKEN=YOUR_SESSION_TOKEN # if using temporary creds
 *   AWS_REGION=us-east-1 # optional, defaults to us-east-1
 *
 * These credentials must belong to an IAM user or role that has permission to:
 *
 * 1) Manage CloudFormation stacks:
 *    - cloudformation:CreateStack
 *    - cloudformation:DeleteStack
 *    - cloudformation:DescribeStacks
 *    - cloudformation:DescribeStackEvents
 *    (You can attach the AWS managed policy 'CloudFormationFullAccess' or
 *     define a custom policy with just these actions.)
 *
 * 2) Read from the S3 bucket where job results are stored:
 *    - s3:ListBucket
 *    - s3:GetObject
 *    (You can attach the AWS managed policy 'AmazonS3ReadOnlyAccess' or
 *     define a custom policy scoped to your bucket path.)
 * 
 * 3) (Optional) SSM access for debugging and development
 * 		- ssm:SendCommand
 * 		- ssm:GetCommandInvocation
 * 		- ssm:StartSession
 * 		- ssm:DescribeInstanceInformation
 * 		- ssm:DescribeSessions
 * 		(You can attach the AWS managed policy 'AmazonSSMFullAccess' or
 * 		define a custom policy with just these actions.)
 *
 * All other resources (EC2 instance roles, SSM instance profile, S3 bucket,
 * etc.) are created and deleted by the CloudFormation template at runtime.
 *
 * For development environments, using static IAM user credentials in a .env
 * file is acceptable for this standalone tool. Be sure to follow least-privilege
 * and rotate credentials regularly.
 */

import 'dotenv/config';
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync, createWriteStream } from "fs";
import { pipeline } from "stream";
import { promisify } from "util";
import path from "path";

const pipe = promisify(pipeline);

async function run() {
  const [, , requiredRamArg, bucketName, amiId] = process.argv;
  if (!requiredRamArg || !bucketName || !amiId) {
    console.error("Usage: run.ts <RequiredMemoryGiB> <BucketName> <AmiId>");
    process.exit(1);
  }
  const requiredRamGiB = Number(requiredRamArg);
  const stackName = "job-runner-stack";
  const region = process.env.AWS_REGION || "us-east-1";
  const templateBody = readFileSync(
    path.resolve(__dirname, "infra.yaml"),
    "utf8"
  );

  const cf = new CloudFormationClient({ region });
  const s3 = new S3Client({ region });

  let stackCreated = false;

  async function cleanupAndExit(code = 1) {
    if (!stackCreated) {
      process.exit(code);
    }
    try {
      console.log("\nInterrupt detected. Deleting CloudFormation stack...");
      await cf.send(new DeleteStackCommand({ StackName: stackName }));
      await waitUntilStackDeleteComplete(
        { client: cf, maxWaitTime: 600 },
        { StackName: stackName }
      );
      console.log("Stack deleted.");
    } catch (err) {
      console.error("Error during cleanup:", err);
    }
    process.exit(code);
  }

  process.on("SIGINT", () => cleanupAndExit(130));
  process.on("SIGTERM", () => cleanupAndExit(130));

  console.log("Deploying CloudFormation stack...");
  await cf.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ["CAPABILITY_IAM"],
      Parameters: [
        { ParameterKey: "RequiredMemoryGiB", ParameterValue: requiredRamGiB.toString() },
        { ParameterKey: "BucketName", ParameterValue: bucketName },
        { ParameterKey: "AmiId", ParameterValue: amiId },
      ],
    })
  );
  await waitUntilStackCreateComplete(
    { client: cf, maxWaitTime: 600 },
    { StackName: stackName }
  );
  stackCreated = true;
  console.log("Stack created.");

  console.log(`Polling for job output in s3://${bucketName}/jobs/`);
  const prefix = "jobs/";
  let foundKey: string | null = null;
  while (!foundKey) {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix })
    );
    if (resp.Contents && resp.Contents.length > 0) {
      const obj = resp.Contents[0];
      if (obj.Key) {
        foundKey = obj.Key;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`Found object key: ${foundKey}`);

  const getResp = await s3.send(
    new GetObjectCommand({ Bucket: bucketName, Key: foundKey! })
  );
  const outStream = createWriteStream(path.basename(foundKey!));
  await pipe(getResp.Body as NodeJS.ReadableStream, outStream);
  console.log("Downloaded output to", path.basename(foundKey!));

  console.log("Deleting CloudFormation stack...");
  await cf.send(new DeleteStackCommand({ StackName: stackName }));
  await waitUntilStackDeleteComplete(
    { client: cf, maxWaitTime: 600 },
    { StackName: stackName }
  );
  console.log("Stack deleted.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

```

and never have to think about the backend infra again.
