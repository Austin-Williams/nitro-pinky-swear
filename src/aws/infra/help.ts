export function showHelp() {
	console.log(`Usage: infra.ts [options]\n` +
		`  --create                Create the CloudFormation stack\n` +
		`    --file[s] <path>      Upload a file to the instance (repeatable, only with --create)\n` +
		`    --script <path>       Run a script on the instance (only with --create)\n` +
		`    --wait [timeout_minutes] After creating, wait for completion signal (optional timeout in minutes)\n` +
		`  --check                 List existing stacks\n` +
		`  --delete                Delete the stack\n` +
		`  --session               Open an SSM session to the instance\n` +
		`  --download <path>       Download artifacts from S3 job/out/ to local path\n` +
		`  --help                  Show this help`)
	process.exit(0)
}