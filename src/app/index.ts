export async function main() {
	console.log('Hello World')
}

main()
	.then(() => console.log('Done'))
	.catch((e) => {
		console.error('Error:', e)
		process.exit(1)
	})
