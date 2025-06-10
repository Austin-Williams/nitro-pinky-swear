# CloudFormation runner for arbitrary jobs (nitro enclave enabled)

## Requirements
- Node.js v18+
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- IAM user or role with these permission policies:
	- AmazonEC2FullAccess
	- AmazonS3FullAccess
	- AmazonSSMFullAccess
	- AWSCloudFormationFullAccess
	- IAMFullAccess
- AWS credentials for the above IAM user or role in `.env`
	- `AWS_ACCESS_KEY_ID`
	- `AWS_SECRET_ACCESS_KEY`
	- `AWS_SESSION_TOKEN` (if using temporary creds)
	- `AWS_REGION` (optional, defaults to `us-east-1`)

## Usage

```bash
npx --no-install tsx infra.ts --help
```

## Example

```bash
# From root directory
# Check stack status
npx --no-install tsx ./src/aws/infra.ts --check
# > Existing CloudFormation stacks: None

# Create stack
# Any file you pass via --file will be uploaded to S3 and made available to the 
# EC2 instance at `/var/lib/job/${filename}`
# If you pass a script (.sh) via --script, it will be uploaded to S3 and executed on the EC2 instance as ec2-user on bootup
npx --no-install tsx ./src/aws/infra.ts --create --file ./tests/circuit.circom --script ./scripts/run-ceremony.sh
# > Creating bucket stack 'job-bucket-stack'...
# > upload: tests/circuit.circom to s3://job-bucket-stack-jobbucket-ueyfllwekgqk/circuit.circom
# > upload: scripts/run-enclave-ceremony.ts to s3://job-bucket-stack-jobbucket-ueyfllwekgqk/run-enclave-ceremony.ts
# > Deploying CloudFormation stack 'job-ec2-stack'. This may take a few minutes...
# > Cloud infrastructure deployed successfully.

# Check stack status
npx --no-install tsx ./src/aws/infra.ts --check
# > Existing CloudFormation stacks:
# >   job-ec2-stack: CREATE_COMPLETE
# >   job-bucket-stack: CREATE_COMPLETE

# Attach to the SSM session if you want to
npx --no-install tsx ./src/aws/infra.ts --session
# > Starting SSM session to instance i-07b1f611cbd62f867...
# > Starting session with SessionId: iam-what-iam-q5xkjga39l3a7agb3cltdgf8oq
# > sh-5.2$ 
```

From within the SSM session, you can join the tmux session
```bash
# Join the tmux session to see the output of your script
ec2-user@ip-172-31-53-123 ~$ sudo su - ec2-user -c "tmux a"
# > You'll see the output of your script here 
# > Type 'exit' to exit the session
```

Back on your local machine:
```bash
# Download any files your EC2 instance has copied to job/out/ on S3
npx --no-install tsx ./src/aws/infra.ts --download ./out
# > Copies everything in job/out/ on S3 to your local ./out directory
```

Back on your local machine:
```bash
# Delete stack when done
npx --no-install tsx ./src/aws/infra.ts --delete
# > Delete EC2 stack 'job-ec2-stack' and bucket stack 'job-bucket-stack'? [y/N] y
# > Deleting stack 'job-ec2-stack'...
# > Stack 'job-ec2-stack' deleted.
# > Emptying bucket 'job-bucket-stack-grothceremonybucket-rntezm6zqgp1'...
# > delete: s3://job-bucket-stack-grothceremonybucket-rntezm6zqgp1/hello-world.sh
# > Deleting bucket stack 'job-bucket-stack'...
# > Bucket stack deleted.
```
