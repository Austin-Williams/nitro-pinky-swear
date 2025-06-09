## General
https://aws.amazon.com/ec2/nitro/nitro-enclaves/
https://www.youtube.com/watch?v=t-XmYt2z5S8 (video on how to use nitro enclaves by AWS)
https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-nitro-instances.html#nitro-instance-types
https://aws.amazon.com/ec2/instance-types/
https://d1.awsstatic.com/events/reinvent/2020/Deep_dive_on_AWS_Nitro_Enclaves_for_apps_running_on_Amazon_EC2_SEC318.pdf


## Security
https://blog.trailofbits.com/2024/09/24/notes-on-aws-nitro-enclaves-attack-surface/
https://api.drand.sh/v2/beacons/default/rounds/latest
https://d1.awsstatic.com/events/Summits/awsottawasummit/SEC301_EnhanceSecurity.pdf
https://eprint.iacr.org/2017/1050.pdf
https://github.com/aws/aws-nitro-enclaves-nsm-api/blob/main/docs/attestation_process.md
// walkthrough of validation process (nends own package I think)
https://aws.amazon.com/blogs/compute/validating-attestation-documents-produced-by-aws-nitro-enclaves/


Scenario	Suggested instance
Largest circuits (≥256 M constraints) or future growth	x8g.48xlarge (3 TiB RAM)
Typical large circuits (up to ≈120 M constraints)	r8g.48xlarge (1.5 TiB RAM)
Mid-size circuits (< 40 M constraints)	m8g.24xlarge (768 GiB)
Tight budget, small test runs	c8g.12xlarge (384 GiB)

>>> Empirically, peak resident RAM is ≈ 4-5 × the size of the .ptau file.

Could just use r8g.16xlarge for everything (cost diff is < $5 for every supportable circuit sizes)
Can only supports circuits up to 2**26 anyway.
the 2**26 ptau file is 72 GB

can use m8g.xlarge for testing (cheaper)