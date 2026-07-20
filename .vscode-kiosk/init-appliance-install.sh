#!/bin/bash
# HARDWARE-SPECIFIC PERSISTENT SYSTEM INSTALLATION SCRIPT

echo "[INITIALIZER]: Commencing disk partition reconnaissance..."
TARGET_DISK="/dev/nvme1n1" # Target your destination second drive partition array safely

# Write pristine GUID Partition Tables (GPT) onto the sectors
sudo parted -s $TARGET_DISK mklabel gpt
sudo parted -s $TARGET_DISK mkpart primary ext4 1MiB 100%

# Compile a true permanent, writeable filesystem over the drive block
sudo mkfs.ext4 -F "${TARGET_DISK}p1"
mkdir -p /mnt/target_workspace
sudo mount "${TARGET_DISK}p1" /mnt/target_workspace

# Clone our exact centralized repository footprint onto the physical disk storage
echo "[SYNC]: Transferring application payload to root filesystems..."
sudo mkdir -p /mnt/target_workspace/C/ANYREALM-
sudo cp -a /C/ANYREALM-/. /mnt/target_workspace/C/ANYREALM-/

# Inject the native background automations manifest
sudo cat <<EOF > /mnt/target_workspace/etc/systemd/system/anyrealm.service
[Unit]
Description=AnyRealm Standalone Dev-Appliance Station
After=network.target NetworkManager.service

[Service]
Type=simple
WorkingDirectory=/C/ANYREALM-
ExecStart=/usr/local/bin/bun run server.ts
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

sudo umount /mnt/target_workspace
echo "[SUCCESS]: Appliance installation layer locked onto storage blocks successfully."
