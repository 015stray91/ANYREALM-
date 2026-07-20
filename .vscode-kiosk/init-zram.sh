#!/bin/bash
# Kernel injection to safely scale hardware swap parameters
sudo swapoff /dev/zram0 2>/dev/null
echo zstd | sudo tee /sys/block/zram0/comp_algorithm
echo 8589934592 | sudo tee /sys/block/zram0/disksize
sudo mkswap /dev/zram0
sudo swapon -p 100 /dev/zram0
