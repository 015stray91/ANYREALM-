#!/usr/bin/env bash
#
# Create the build engine instance, and keep its key somewhere it will not be lost.
#
# The last instance was deleted and its key with it. Two things prevent a repeat:
#
#   1. The private key is written to a named file under ~/.ssh and reported at the
#      end of the run, with its fingerprint. A key whose location is printed is a
#      key you can find again.
#   2. SSH access is opened to this machine's current public address only, not to
#      0.0.0.0/0. The previous instance timed out because the security group did
#      not include this address; this reads the address at create time and says
#      so, rather than assuming.
#
# What it does NOT do: install anything on the box. That is setup, and setup is a
# separate, visible step -- a user data script that quietly fails leaves an
# instance that is "running" and useless.
#
# Usage:
#   ./scripts/create-engine.sh                 # defaults below
#   INSTANCE_TYPE=c7i.xlarge ./scripts/create-engine.sh
#   REGION=us-east-2 KEY_NAME=anyrealm-engine ./scripts/create-engine.sh
#
set -euo pipefail

REGION="${REGION:-us-east-2}"
PROFILE="${PROFILE:-anyrealm}"
KEY_NAME="${KEY_NAME:-anyrealm-engine}"
SG_NAME="${SG_NAME:-anyrealm-engine}"
INSTANCE_TYPE="${INSTANCE_TYPE:-m7i-flex.large}"
# 60 GB gp3 is enough for a kernel tree plus build output (an out/ tree for a
# 6.x kernel is roughly 15-25 GB) with room to keep two of them.
VOLUME_GB="${VOLUME_GB:-60}"
SSH_DIR="${HOME}/.ssh"
KEY_FILE="${SSH_DIR}/${KEY_NAME}.pem"
TAG_PROJECT="${TAG_PROJECT:-anyrealm}"
TAG_ROLE="${TAG_ROLE:-build-engine}"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || fail "aws CLI not found"
command -v jq >/dev/null || fail "jq not found (needed to read the json output)"

say "checking credentials for profile '${PROFILE}'"
if ! aws sts get-caller-identity --profile "$PROFILE" >/tmp/engine-ident.json 2>/dev/null; then
  cat <<EOF

No credentials for profile '${PROFILE}'.

Sign in first. This opens a browser and prints a code to paste back:

  aws login --region ${REGION} --profile ${PROFILE}

That code is a credential: do not paste it into a chat. Run it in the app's
Terminal tab (Settings -> shell), then run this script again.
EOF
  exit 2
fi
ACCOUNT=$(jq -r .Account /tmp/engine-ident.json)
ARN=$(jq -r .Arn /tmp/engine-ident.json)
say "signed in as ${ARN} (account ${ACCOUNT})"

say "this machine's public address, for the security group"
MY_IP="$(curl -fsS --max-time 20 https://checkip.amazonaws.com | tr -d '\n')"
[ -n "$MY_IP" ] || fail "could not determine this machine's public address"
CIDR="${MY_IP}/32"
say "allowing ssh from ${CIDR} only"

# ---- key pair -------------------------------------------------------------
#
# Created here rather than in the console, so the private half lands in a file we
# name and the public half goes to AWS in one step. A key created in the console
# is downloaded once and is gone if that download is missed.

if [ -f "$KEY_FILE" ]; then
  say "key file already exists at ${KEY_FILE} -- reusing it"
else
  say "creating key pair '${KEY_NAME}'"
  mkdir -p "$SSH_DIR"; chmod 700 "$SSH_DIR"
  # If the name is taken in this account but the local file is gone, creating it
  # again fails. Removing a key pair from AWS does not affect running instances
  # that already have it, so this is safe to do deliberately.
  if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
    fail "a key pair named '${KEY_NAME}' exists in ${REGION} but ${KEY_FILE} is missing.
Its private half cannot be downloaded again -- AWS never stores it.
Either use a different name:   KEY_NAME=${KEY_NAME}-2 $0
or delete the stale pair:      aws ec2 delete-key-pair --key-name ${KEY_NAME} --region ${REGION} --profile ${PROFILE}"
  fi
  aws ec2 create-key-pair \
    --key-name "$KEY_NAME" --region "$REGION" --profile "$PROFILE" \
    --query 'KeyMaterial' --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  say "wrote ${KEY_FILE} (mode 600)"
fi

if ! ssh-keygen -y -f "$KEY_FILE" >/dev/null 2>&1; then
  fail "${KEY_FILE} is not a usable private key"
fi
FINGERPRINT="$(ssh-keygen -lf "$KEY_FILE" | awk '{print $2}')"
say "key fingerprint ${FINGERPRINT}"

# ---- security group -------------------------------------------------------

say "security group '${SG_NAME}'"
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=tag:Project,Values=${TAG_PROJECT}" \
  --region "$REGION" --profile "$PROFILE" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
    --region "$REGION" --profile "$PROFILE" --query 'Vpcs[0].VpcId' --output text)
  [ "$VPC_ID" != "None" ] && [ -n "$VPC_ID" ] || fail "no default VPC in ${REGION}; pass a VPC explicitly"
  say "creating group in ${VPC_ID}"
  SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" --description "AnyRealm build engine: ssh from the builder only" \
    --vpc-id "$VPC_ID" --region "$REGION" --profile "$PROFILE" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=${TAG_PROJECT}},{Key=Role,Value=${TAG_ROLE}}]" \
    --query 'GroupId' --output text)
else
  say "reusing existing group ${SG_ID}"
fi

# Replace rather than add: one address, the current one. An allow-rule that only
# ever grows is how a box ends up open to a network nobody remembers allowing.
if ! aws ec2 authorize-security-group-ingress \
      --group-id "$SG_ID" --protocol tcp --port 22 --cidr "$CIDR" \
      --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
  say "rule for ${CIDR} already present or refused; continuing"
fi

# ---- instance -------------------------------------------------------------

say "looking for an Ubuntu 24.04 LTS x86_64 image"
AMI_ID=$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --region "$REGION" --profile "$PROFILE" --query 'Parameter.Value' --output text 2>/dev/null || true)
if [ -z "$AMI_ID" ] || [ "$AMI_ID" = "None" ]; then
  say "ssm parameter unavailable; falling back to the newest Canonical ubuntu/images/hvm-ssd-gp3 entry"
  AMI_ID=$(aws ec2 describe-images --owners 099720109477 --region "$REGION" --profile "$PROFILE" \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
              "Name=state,Values=available" \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
fi
[ -n "$AMI_ID" ] && [ "$AMI_ID" != "None" ] || fail "could not find an Ubuntu 24.04 image in ${REGION}"
say "image ${AMI_ID}"

say "launching ${INSTANCE_TYPE} (${VOLUME_GB} GB gp3)"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --region "$REGION" --profile "$PROFILE" \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${TAG_ROLE}},{Key=Project,Value=${TAG_PROJECT}},{Key=Role,Value=${TAG_ROLE}}]" \
  --query 'Instances[0].InstanceId' --output text)
say "instance ${INSTANCE_ID} requested"

say "waiting for it to be running"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION" --profile "$PROFILE"

IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$REGION" --profile "$PROFILE" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
[ -n "$IP" ] && [ "$IP" != "None" ] || fail "instance has no public address; it may be in a private subnet"

say "waiting for ssh (up to ~3 minutes; cloud-init must start sshd)"
for i in $(seq 1 36); do
  if ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
        -o BatchMode=yes "ubuntu@${IP}" true >/dev/null 2>&1; then
    say "ssh is up after ~$((i*5))s"
    break
  fi
  [ "$i" = "36" ] && fail "ssh never came up. Check the security group allows ${CIDR} and the instance is in a public subnet."
  sleep 5
done

cat <<EOF

------------------------------------------------------------------
engine ready

  instance    ${INSTANCE_ID}
  address     ubuntu@${IP}
  key         ${KEY_FILE}
  fingerprint ${FINGERPRINT}
  region      ${REGION}
  type        ${INSTANCE_TYPE}

Register it in the app (the engine slot, not the model slot):

  curl -X POST http://127.0.0.1:3000/api/plugins/terminal-lab/vm/connections/engine/endpoints \\
    -H 'Content-Type: application/json' \\
    -d '{"host":"${IP}","user":"ubuntu","label":"aws-engine","kind":"public"}'

Then, in the app's Terminal tab -> Settings: set the engine's identity to
${KEY_FILE} and press probe. The probe is the proof, not this message.

To reach it from here by hand:

  ssh -i ${KEY_FILE} ubuntu@${IP}

To stop paying for it without losing the disk:

  aws ec2 stop-instances --instance-ids ${INSTANCE_ID} --region ${REGION} --profile ${PROFILE}

To delete it AND its disk (this is what lost the last one):

  aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --region ${REGION} --profile ${PROFILE}

Notes on the choice of instance type are in the message that followed this
script; briefly: ${INSTANCE_TYPE} is chosen for memory per dollar, not peak cores,
because a kernel build on 2 cores is slower but finishes, while running out of
RAM fails.
------------------------------------------------------------------
EOF
