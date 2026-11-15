#!/usr/bin/env bash
# Creates an Oracle Cloud *Always Free* VM for plzbot.me with the `oci` CLI: VCN, public
# subnet, internet gateway, security list opening 22/80/443, and an Ubuntu ARM instance
# (VM.Standard.A1.Flex, 2 OCPU / 12 GB — within the free allowance) with Docker preinstalled
# via cloud-init. Idempotent-ish: re-running reuses resources that already carry the tag.
#
# Usage: deploy/oci-create-vm.sh [ssh-public-key-path]
# Requires: oci CLI configured (`oci setup config`), jq.
set -euo pipefail
export SUPPRESS_LABEL_WARNING=True
SSH_KEY="${1:-$HOME/.ssh/id_ed25519.pub}"
NAME="${PLZBOT_VM_NAME:-plzbot}"
SHAPE="${PLZBOT_VM_SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${PLZBOT_VM_OCPUS:-2}"
MEM_GB="${PLZBOT_VM_MEM_GB:-12}"

TENANCY=$(grep -E '^tenancy=' ~/.oci/config | head -1 | cut -d= -f2)
COMPARTMENT="${PLZBOT_OCI_COMPARTMENT:-$TENANCY}"
AD=$(oci iam availability-domain list --compartment-id "$COMPARTMENT" --query 'data[0].name' --raw-output)

find_or_create() { # <kind> <list-cmd...> ; stdin: create cmd
  local id
  id=$(eval "$2" 2>/dev/null || true)
  if [ -n "$id" ] && [ "$id" != "null" ]; then echo "$id"; return; fi
  eval "$3"
}

echo "compartment=$COMPARTMENT ad=$AD" >&2

VCN=$(find_or_create vcn \
  "oci network vcn list -c '$COMPARTMENT' --display-name '$NAME-vcn' --query 'data[0].id' --raw-output" \
  "oci network vcn create -c '$COMPARTMENT' --display-name '$NAME-vcn' --cidr-block 10.42.0.0/16 --dns-label plzbot --wait-for-state AVAILABLE --query 'data.id' --raw-output")
IGW=$(find_or_create igw \
  "oci network internet-gateway list -c '$COMPARTMENT' --vcn-id '$VCN' --query 'data[0].id' --raw-output" \
  "oci network internet-gateway create -c '$COMPARTMENT' --vcn-id '$VCN' --is-enabled true --display-name '$NAME-igw' --wait-for-state AVAILABLE --query 'data.id' --raw-output")
RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
oci network route-table update --rt-id "$RT" --force \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
SL=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)
oci network security-list update --security-list-id "$SL" --force \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' \
  --ingress-security-rules '[
    {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
    {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
    {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}]' >/dev/null
SUBNET=$(find_or_create subnet \
  "oci network subnet list -c '$COMPARTMENT' --vcn-id '$VCN' --display-name '$NAME-subnet' --query 'data[0].id' --raw-output" \
  "oci network subnet create -c '$COMPARTMENT' --vcn-id '$VCN' --display-name '$NAME-subnet' --cidr-block 10.42.1.0/24 --dns-label pub --wait-for-state AVAILABLE --query 'data.id' --raw-output")

IMAGE=$(oci compute image list -c "$COMPARTMENT" --operating-system "Canonical Ubuntu" --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query "data[?contains(\"display-name\", 'aarch64') || '$SHAPE' != 'VM.Standard.A1.Flex'] | [?!contains(\"display-name\", 'Minimal')] | [0].id" --raw-output)

CLOUD_INIT=$(mktemp)
cat > "$CLOUD_INIT" <<'CI'
#cloud-config
package_update: true
packages: [git, curl, ca-certificates]
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker ubuntu
  - iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  - iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  - netfilter-persistent save || true
  - sudo -u ubuntu git clone https://github.com/thedtripp/plzbot.me.git /home/ubuntu/plzbot.me
CI

EXISTING=$(oci compute instance list -c "$COMPARTMENT" --display-name "$NAME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output 2>/dev/null || true)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
  INSTANCE="$EXISTING"; echo "instance exists: $INSTANCE" >&2
else
  INSTANCE=$(oci compute instance launch -c "$COMPARTMENT" --availability-domain "$AD" --display-name "$NAME" \
    --shape "$SHAPE" --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM_GB}" --image-id "$IMAGE" --subnet-id "$SUBNET" \
    --assign-public-ip true --ssh-authorized-keys-file "$SSH_KEY" --user-data-file "$CLOUD_INIT" \
    --wait-for-state RUNNING --query 'data.id' --raw-output)
fi
IP=$(oci compute instance list-vnics --instance-id "$INSTANCE" --query 'data[0]."public-ip"' --raw-output)
echo "instance=$INSTANCE"
echo "public_ip=$IP"
echo "hostname=$(echo "$IP" | tr . -).sslip.io"
echo "ssh ubuntu@$IP"
