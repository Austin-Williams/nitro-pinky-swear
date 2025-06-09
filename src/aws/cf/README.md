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
npx --no-install tsx ./src/aws/cf/infra.ts --check
# > Existing CloudFormation stacks: None

# Create stack
# Any file you pass via --file will be uploaded to S3 and made available to the 
# EC2 instance at `/var/lib/job/${filename}`
# If you pass a script (.sh) via --script, it will be uploaded to S3 and executed on the EC2 instance as root on bootup
npx --no-install tsx ./src/aws/cf/infra.ts --create --file ./src/zk/example/circuit.circom --script ./tests/hello-world.sh
# > Creating bucket stack 'job-bucket-stack'...
# > Uploading circuit.circom to s3://job-bucket-stack-jobbucket-ueyfllwekgqk/circuit.circom...
# > upload: src/zk/example/circuit.circom to s3://job-bucket-stack-jobbucket-ueyfllwekgqk/circuit.circom
# > Uploading script hello-world.sh to s3://job-bucket-stack-jobbucket-ueyfllwekgqk/hello-world.sh...
# > upload: tests/hello-world.sh to s3://job-bucket-stack-jobbucket-ueyfllwekgqk/hello-world.sh
# > Deploying CloudFormation stack 'job-ec2-stack'. This may take a few minutes...
# > Stack created.

# Check stack status
npx --no-install tsx ./src/aws/cf/infra.ts --check
# > Existing CloudFormation stacks:
# >   job-ec2-stack: CREATE_COMPLETE
# >   job-bucket-stack: CREATE_COMPLETE

# Attach to the SSM session if you want to
npx --no-install tsx ./src/aws/cf/infra.ts --session
# > Starting SSM session to instance i-07b1f611cbd62f867...
# > Starting session with SessionId: iam-what-iam-q5xkjga39l3a7agb3cltdgf8oq
# > sh-5.2$ 
```

From within the SSM session, you can join the tmux session
```bash
# Join the tmux session to see the output of your script
ec2-user@ip-172-31-53-123 ~$ sudo tmux a
# > You'll see the output of your script here 
# > Type 'exit' to exit the session
```

Back on your local machine:
```bash
# Delete stack when done
npx --no-install tsx ./src/aws/cf/infra.ts --delete
# > Delete EC2 stack 'job-ec2-stack' and bucket stack 'job-bucket-stack'? [y/N] y
# > Deleting stack 'job-ec2-stack'...
# > Stack 'job-ec2-stack' deleted.
# > Emptying bucket 'job-bucket-stack-grothceremonybucket-rntezm6zqgp1'...
# > delete: s3://job-bucket-stack-grothceremonybucket-rntezm6zqgp1/hello-world.sh
# > Deleting bucket stack 'job-bucket-stack'...
# > Bucket stack deleted.
```
