#!/bin/bash

set -e

cd ~/Desktop/blockchain_game

echo "Activating Python virtual environment..."
source .venv/bin/activate

echo
echo "Using Python:"
which python

echo
echo "Python version:"
python --version

echo
echo "Running blockchain connection check..."
python connect_check.py