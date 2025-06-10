export function showHelp() {
	console.log(`Usage: infra.ts [options]\n` +
		`  --create                Create the CloudFormation stack\n` +
		`    --file[s] <path>      Upload a file to the instance (repeatable, only with --create)\n` +
		`    --script <path>       Run a script on the instance (only with --create)\n` +
		`    --wait [timeout_minutes] After creating, wait for completion signal (optional timeout in minutes)\n` +
		`    --instance-type <type> Specify EC2 instance type (optional, defaults to env var or template default)\n` +
		`  --check                 List existing stacks\n` +
		`  --delete                Delete the stack\n` +
		`    --yes                 Bypass confirmation prompt (only with --delete)\n` +
		`  --session               Open an SSM session to the instance\n` +
		`  --download [path]       Download artifacts from S3 job/out/ to local path (defaults to 'out/')\n` +
		`  --run-job               Run a full job: create, wait, download, then delete infrastructure\n` +
		`    --file[s] <path>      Upload file(s) to instance (optional with --run-job, repeatable)\n` +
		`    --script <path>       Run script on instance (required with --run-job)\n` +
		`    --output [path]       Local path for downloaded artifacts (optional with --run-job, defaults to 'out/')\n` +
		`    --wait [timeout_minutes] Override default wait timeout for job completion (optional with --run-job)\n` +
		`    --instance-type <type> Specify EC2 instance type for the job (optional with --run-job)\n` +
		`  --help                  Show this help`)
	process.exit(0)
}