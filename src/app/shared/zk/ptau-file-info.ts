// These are all values copied from the table here: https://github.com/iden3/snarkjs/tree/bf28b1cb5aefcefab7e0f70f1fa5e40f764cca72?tab=readme-ov-file#7-prepare-phase-2

export interface PtauFileInfo {
	maxConstraints: number
	blake2b: string
	power: number
	url: string
}

export const ptauFiles: Record<number, PtauFileInfo> = {
	8: {
		maxConstraints: 256,
		blake2b: 'd6a8fb3a04feb600096c3b791f936a578c4e664d262e4aa24beed1b7a9a96aa5eb72864d628db247e9293384b74b36ffb52ca8d148d6e1b8b51e279fdf57b583',
		power: 8,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_08.ptau'
	},
	9: {
		maxConstraints: 512,
		blake2b: '94f108a80e81b5d932d8e8c9e8fd7f46cf32457e31462deeeef37af1b71c2c1b3c71fb0d9b59c654ec266b042735f50311f9fd1d4cadce47ab234ad163157cb5',
		power: 9,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_09.ptau'
	},
	10: {
		maxConstraints: 1024,
		blake2b: '6cfeb8cda92453099d20120bdd0e8a5c4e7706c2da9a8f09ccc157ed2464d921fd0437fb70db42104769efd7d6f3c1f964bcf448c455eab6f6c7d863e88a5849',
		power: 10,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_10.ptau'
	},
	11: {
		maxConstraints: 2048,
		blake2b: '47c282116b892e5ac92ca238578006e31a47e7c7e70f0baa8b687f0a5203e28ea07bbbec765a98dcd654bad618475d4661bfaec3bd9ad2ed12e7abc251d94d33',
		power: 11,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_11.ptau'
	},
	12: {
		maxConstraints: 4096,
		blake2b: 'ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a',
		power: 12,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau'
	},
	13: {
		maxConstraints: 8192,
		blake2b: '58efc8bf2834d04768a3d7ffcd8e1e23d461561729beaac4e3e7a47829a1c9066d5320241e124a1a8e8aa6c75be0ba66f65bc8239a0542ed38e11276f6fdb4d9',
		power: 13,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_13.ptau'
	},
	14: {
		maxConstraints: 16384,
		blake2b: 'eeefbcf7c3803b523c94112023c7ff89558f9b8e0cf5d6cdcba3ade60f168af4a181c9c21774b94fbae6c90411995f7d854d02ebd93fb66043dbb06f17a831c1',
		power: 14,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau'
	},
	15: {
		maxConstraints: 32768,
		blake2b: '982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e',
		power: 15,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau'
	},
	16: {
		maxConstraints: 65536,
		blake2b: '6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125',
		power: 16,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau'
	},
	17: {
		maxConstraints: 131072,
		blake2b: '6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345',
		power: 17,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_17.ptau'
	},
	18: {
		maxConstraints: 262144,
		blake2b: '7e6a9c2e5f05179ddfc923f38f917c9e6831d16922a902b0b4758b8e79c2ab8a81bb5f29952e16ee6c5067ed044d7857b5de120a90704c1d3b637fd94b95b13e',
		power: 18,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_18.ptau'
	},
	19: {
		maxConstraints: 524288,
		blake2b: 'bca9d8b04242f175189872c42ceaa21e2951e0f0f272a0cc54fc37193ff6648600eaf1c555c70cdedfaf9fb74927de7aa1d33dc1e2a7f1a50619484989da0887',
		power: 19,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_19.ptau'
	},
	20: {
		maxConstraints: 1048576,
		blake2b: '89a66eb5590a1c94e3f1ee0e72acf49b1669e050bb5f93c73b066b564dca4e0c7556a52b323178269d64af325d8fdddb33da3a27c34409b821de82aa2bf1a27b',
		power: 20,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_20.ptau'
	},
	21: {
		maxConstraints: 2097152,
		blake2b: '9aef0573cef4ded9c4a75f148709056bf989f80dad96876aadeb6f1c6d062391f07a394a9e756d16f7eb233198d5b69407cca44594c763ab4a5b67ae73254678',
		power: 21,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_21.ptau'
	},
	22: {
		maxConstraints: 4194304,
		blake2b: '0d64f63dba1a6f11139df765cb690da69d9b2f469a1ddd0de5e4aa628abb28f787f04c6a5fb84a235ec5ea7f41d0548746653ecab0559add658a83502d1cb21b',
		power: 22,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_22.ptau'
	},
	23: {
		maxConstraints: 8388608,
		blake2b: '3063a0bd81d68711197c8820a92466d51aeac93e915f5136d74f63c394ee6d88c5e8016231ea6580bec02e25d491f319d92e77f5c7f46a9caa8f3b53c0ea544f',
		power: 23,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_23.ptau'
	},
	24: {
		maxConstraints: 16777216,
		blake2b: 'fa404d140d5819d39984833ca5ec3632cd4995f81e82db402371a4de7c2eae8687c62bc632a95b0c6aadba3fb02680a94e09174b7233ccd26d78baca2647c733',
		power: 24,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_24.ptau'
	},
	25: {
		maxConstraints: 33554432,
		blake2b: '0377d860cdb09a8a31ea1b0b8c04335614c8206357181573bf294c25d5ca7dff72387224fbd868897e6769f7805b3dab02854aec6d69d7492883b5e4e5f35eeb',
		power: 25,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_25.ptau'
	},
	26: {
		maxConstraints: 67108864,
		blake2b: '418dee4a74b9592198bd8fd02ad1aea76f9cf3085f206dfd7d594c9e264ae919611b1459a1cc920c2f143417744ba9edd7b8d51e44be9452344a225ff7eead19',
		power: 26,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_26.ptau'
	},
	27: {
		maxConstraints: 134217728,
		blake2b: '10ffd99837c512ef99752436a54b9810d1ac8878d368fb4b806267bdd664b4abf276c9cd3c4b9039a1fa4315a0c326c0e8e9e8fe0eb588ffd4f9021bf7eae1a1',
		power: 27,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_27.ptau'
	},
	28: {
		maxConstraints: 268435456,
		blake2b: '55c77ce8562366c91e7cda394cf7b7c15a06c12d8c905e8b36ba9cf5e13eb37d1a429c589e8eaba4c591bc4b88a0e2828745a53e170eac300236f5c1a326f41a',
		power: 28,
		url: 'https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_28.ptau'
	}
}
