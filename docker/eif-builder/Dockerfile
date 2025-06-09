FROM amazonlinux@sha256:c3381e594bead0d6e859ae15b587854e3afc634e13a1ebdeef26a66ccdad46cd

# Need both packages: CLI (binary) + DEVEL (kernel/initrd blobs)
RUN dnf -y install \
	aws-nitro-enclaves-cli-1.4.2-0.amzn2023 \
	aws-nitro-enclaves-cli-devel-1.4.2-0.amzn2023 \
	&& dnf clean all

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
