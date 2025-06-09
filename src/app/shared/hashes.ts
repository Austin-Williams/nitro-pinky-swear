import { createHash } from 'crypto'
import { readFileSync } from 'fs'

export function blake2b512HashOfFile(filePath: string): string {
	const buffer = readFileSync(filePath)
	return createHash('blake2b512').update(buffer).digest('hex')
}

export function sha256HashOfFile(filePath: string): string {
	const buffer = readFileSync(filePath)
	return createHash('sha256').update(buffer).digest('hex')
}

export function sha256HashOfString(input: string): string {
	return createHash('sha256')
		.update(input, 'utf8')
		.digest('hex')
}