###########################
# Stage 1 – build Circom, libnsm, and attestation helper
###########################
FROM rust:1.75-slim@sha256:70c2a016184099262fd7cee46f3d35fec3568c45c62f87e37f7f665f766b1f74 AS circom-builder

ARG CIRCOM_COMMIT=de2212a7aa6a070c636cc73382a3deba8c658ad5
ARG DEBIAN_SNAPSHOT_DATE=20250607T000000Z
ARG SOURCE_DATE_EPOCH_TS=1749359229
ARG NSM_API_TAG=v0.4.0

# 1. Minimal build tooling
RUN \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm main" > /etc/apt/sources.list && \
	echo "deb http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT_DATE}/ bookworm-security main" >> /etc/apt/sources.list && \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm-updates main" >> /etc/apt/sources.list && \
	export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH_TS} && \
	apt-get update && \
	apt-get install -y --no-install-recommends \
	git=1:2.39.5-0+deb12u2 \
	build-essential=12.9 \
	ca-certificates=20230311 && \
	rm -rf /var/lib/apt/lists/*

# 2. Fetch just that commit (shallow) and check it out
RUN git clone --no-checkout https://github.com/iden3/circom.git /circom && \
	cd /circom && \
	git fetch --depth 1 origin $CIRCOM_COMMIT && \
	git checkout $CIRCOM_COMMIT

WORKDIR /circom

# 3. Make Cargo’s metadata deterministic
RUN export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH_TS} && \
	cargo build --release

# 3a. Normalise & shrink circom binary
RUN \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm main" > /etc/apt/sources.list.d/snapshot.list && \
	echo "deb http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT_DATE}/ bookworm-security main" >> /etc/apt/sources.list.d/snapshot.list && \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm-updates main" >> /etc/apt/sources.list.d/snapshot.list && \
	export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH_TS} && \
	apt-get update && \
	apt-get install -y --no-install-recommends binutils=2.40-2 strip-nondeterminism=1.13.1-1 && \
	strip --strip-unneeded /circom/target/release/circom && \
	strip-nondeterminism /circom/target/release/circom && \
	apt-get purge -y binutils strip-nondeterminism && \
	apt-get autoremove -y && \
	rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/snapshot.list

# 4. Build libnsm
RUN \
	export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH_TS} && \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm main" > /etc/apt/sources.list.d/libnsm.list && \
	echo "deb http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT_DATE}/ bookworm-security main" >> /etc/apt/sources.list.d/libnsm.list && \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm-updates main" >> /etc/apt/sources.list.d/libnsm.list && \
	apt-get update && \
	apt-get install -y --no-install-recommends gcc=4:12.2.0-3 && \
	git clone --depth 1 --branch ${NSM_API_TAG} https://github.com/aws/aws-nitro-enclaves-nsm-api.git /tmp/nsm-api && \
	cargo build --manifest-path /tmp/nsm-api/nsm-lib/Cargo.toml --release --target-dir /tmp/nsm-api/target && \
	mkdir -p /opt/nsm_artifacts/lib /opt/nsm_artifacts/include/nsm && \
	cp /tmp/nsm-api/target/release/libnsm.so /opt/nsm_artifacts/lib/ && \
	cp /tmp/nsm-api/target/release/libnsm.a /opt/nsm_artifacts/lib/ && \
	(   cp /tmp/nsm-api/target/release/nsm.h /opt/nsm_artifacts/include/nsm/ 2>/dev/null || \
	cp /tmp/nsm-api/target/release/build/nsm-lib-*/out/nsm.h /opt/nsm_artifacts/include/nsm/ ) && \
	rm -rf /tmp/nsm-api && \
	apt-get purge -y gcc && \
	apt-get autoremove -y && \
	rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/libnsm.list

# 5. Build attestation helper
COPY src/app/enclave/attestation/get-attestation.c /tmp/get-attestation.c
RUN \
	export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH_TS} && \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm main" > /etc/apt/sources.list.d/attestation.list && \
	echo "deb http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT_DATE}/ bookworm-security main" >> /etc/apt/sources.list.d/attestation.list && \
	echo "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT_DATE}/ bookworm-updates main" >> /etc/apt/sources.list.d/attestation.list && \
	apt-get update && \
	apt-get install -y --no-install-recommends \
	gcc=4:12.2.0-3 \
	libc6-dev=2.36-9+deb12u10 && \
	mkdir -p /opt/attestation_helper && \
	gcc -I/opt/nsm_artifacts/include/nsm \
	-o /opt/attestation_helper/get-attestation /tmp/get-attestation.c \
	-L/opt/nsm_artifacts/lib -lnsm && \
	strip --strip-unneeded /opt/attestation_helper/get-attestation && \
	apt-get purge -y gcc libc6-dev && \
	apt-get autoremove -y && \
	rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/attestation.list /tmp/get-attestation.c

###########################
# Stage 2 – runtime image
###########################
FROM node:18-slim@sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e

ARG DEBIAN_SNAPSHOT_DATE=20250607T000000Z
ARG SOURCE_DATE_EPOCH_TS=1749359229

# Copy Circom binary
COPY --from=circom-builder /circom/target/release/circom /usr/local/bin/circom

# Copy libnsm artifacts from circom-builder stage
COPY --from=circom-builder /opt/nsm_artifacts/lib/libnsm.so /usr/lib/

# Copy compiled attestation helper from Stage 1
COPY --from=circom-builder /opt/attestation_helper/get-attestation /bin/get-attestation

# App setup
WORKDIR /app
COPY src/app/enclave/package.json ./package.json
COPY src/app/enclave/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund

COPY src/app/enclave ./src/app/enclave
COPY src/app/shared ./src/app/shared

COPY docker/enclave/run.sh ./run.sh
RUN chmod +x ./run.sh

CMD ["/app/run.sh"]
