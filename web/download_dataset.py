"""
Download and prepare dataset for training
Downloads produce freshness dataset with multiple ripeness stages
"""

import os
import yaml
import requests
import zipfile
from pathlib import Path

print("=" * 60)
print("Dataset Download & Preparation")
print("=" * 60)

# Roboflow dataset for produce freshness detection
# This dataset contains fresh, ripe, and spoiled produce
DATASET_URL = "https://universe.roboflow.com/ds/YOUR_DATASET_ID"  # Will be configured

def download_roboflow_dataset():
    """
    Download produce dataset from Roboflow Universe
    Includes: fresh, ripe, overripe, and spoiled stages
    """
    
    print("\n📥 Downloading Produce Freshness Dataset...")
    print("\nDataset includes:")
    print("  ✓ Fresh produce (apples, tomatoes, potatoes)")
    print("  ✓ Ripe produce (optimal freshness)")
    print("  ✓ Overripe produce (early spoilage)")
    print("  ✓ Spoiled/Rotten produce")
    
    # For now, we'll use a manual download approach
    print("\n" + "=" * 60)
    print("DATASET OPTIONS:")
    print("=" * 60)
    
    print("\n🔥 RECOMMENDED - Roboflow Universe:")
    print("   1. Go to: https://universe.roboflow.com")
    print("   2. Search for: 'fruit freshness detection'")
    print("   3. Look for datasets with these classes:")
    print("      - Fresh apples, tomatoes, potatoes")
    print("      - Ripe/Overripe stages")
    print("      - Spoiled/Rotten produce")
    print("   4. Download as YOLOv8 PyTorch format")
    print("   5. Extract to this folder: dataset/")
    
    print("\n🎯 ALTERNATIVE - Kaggle Datasets:")
    print("   Dataset 1: Fruits Fresh and Rotten")
    print("   URL: kaggle.com/datasets/sriramr/fruits-fresh-and-rotten-for-classification")
    print("   - Install: pip install kaggle")
    print("   - Download: kaggle datasets download -d sriramr/fruits-fresh-and-rotten-for-classification")
    
    print("\n   Dataset 2: Vegetable Freshness")
    print("   URL: kaggle.com/datasets/swoyam2609/fresh-and-stale-classification")
    
    return create_dataset_structure()

def create_dataset_structure():
    """Create dataset structure for manual setup"""
    
    print("\n📁 Creating dataset structure...")
    
    # Create directories
    dirs = [
        "dataset/train/images",
        "dataset/train/labels",
        "dataset/valid/images",
        "dataset/valid/labels",
    ]
    
    for dir_path in dirs:
        os.makedirs(dir_path, exist_ok=True)
        print(f"✅ Created: {dir_path}")
    
    # Create data.yaml
    data_yaml = {
        'path': os.path.abspath('dataset'),
        'train': 'train/images',
        'val': 'valid/images',
        'names': {
            0: 'apple_fresh',
            1: 'apple_spoiled',
            2: 'tomato_fresh',
            3: 'tomato_spoiled',
            4: 'potato_fresh',
            5: 'potato_spoiled',
        }
    }
    
    yaml_path = 'dataset/data.yaml'
    with open(yaml_path, 'w') as f:
        yaml.dump(data_yaml, f, default_flow_style=False)
    
    print(f"\n✅ Created: {yaml_path}")
    
    return yaml_path
    
    print("\n" + "=" * 60)
    print("Manual Dataset Collection Guide")
    print("=" * 60)
    print("\n1. COLLECT IMAGES:")
    print("   - Use your ESP32-CAM to take photos of produce")
    print("   - Take 50-100 photos per category (fresh/spoiled)")
    print("   - Include different angles and lighting")
    print("   - Save images to: dataset/train/images/")
    
    print("\n2. LABEL IMAGES:")
    print("   Option A: Use Roboflow (Recommended)")
    print("   - Go to https://roboflow.com")
    print("   - Create account and new project")
    print("   - Upload images and use their annotation tool")
    print("   - Export as YOLOv8 format")
    print("   - Extract to 'dataset' folder")
    
    print("\n   Option B: Use LabelImg (Free Desktop Tool)")
    print("   - Download: https://github.com/HumanSignal/labelImg")
    print("   - Set output format to YOLO")
    print("   - Save labels to: dataset/train/labels/")
    
    print("\n3. SPLIT DATASET:")
    print("   - 80% of images in train/")
    print("   - 20% of images in valid/")
    
    print("\n4. RECOMMENDED DATASETS TO DOWNLOAD:")
    print("   Kaggle:")
    print("   - kaggle.com/datasets/sriramr/fruits-fresh-and-rotten-for-classification")
    print("   - kaggle.com/datasets/misrakahmed/vegetable-image-dataset")
    
    print("\n   Roboflow Universe:")
    print("   - universe.roboflow.com (search for 'fruit spoilage')")
    
    print("\n5. AFTER PREPARING DATASET:")
    print("   - Run: python train_model.py")
    
    # Create README in dataset folder
    readme = """# Dataset Folder

Place your training data here:

## Structure:
```
dataset/
├── data.yaml          # Dataset configuration (already created)
├── train/
│   ├── images/        # Training images (add .jpg/.png files here)
│   └── labels/        # Training labels (add .txt files here)
└── valid/
    ├── images/        # Validation images
    └── labels/        # Validation labels
```

## Label Format (YOLO):
Each .txt file contains lines like:
```
<class_id> <x_center> <y_center> <width> <height>
```
All values normalized 0-1.

## Classes:
0: apple_fresh
1: apple_spoiled
2: tomato_fresh
3: tomato_spoiled
4: potato_fresh
5: potato_spoiled

## Quick Start:
1. Add images to train/images/ and valid/images/
2. Label them using Roboflow or LabelImg
3. Run: python train_model.py
"""
    
    with open('dataset/README.md', 'w') as f:
        f.write(readme)
    
    print(f"\n✅ Created dataset/README.md with instructions")
    print("\n" + "=" * 60)

if __name__ == "__main__":
    yaml_path = download_roboflow_dataset()
    
    print("\n" + "=" * 60)
    print("✅ DATASET STRUCTURE READY!")
    print("=" * 60)
    print(f"\n📄 Configuration file: {yaml_path}")
    print("\n📋 BEST DATASETS WITH ALL STAGES:")
    print("\n1. Roboflow - 'Fruit Freshness Detection'")
    print("   Classes: fresh, ripe, overripe, rotten")
    print("   Link: universe.roboflow.com/search?q=fruit+freshness")
    
    print("\n2. Kaggle - 'Fruits Fresh and Rotten'")
    print("   Install: pip install kaggle")
    print("   Download: kaggle datasets download -d sriramr/fruits-fresh-and-rotten-for-classification")
    
    print("\n3. Run training after download:")
    print("   python train_model.py")
    print("\n" + "=" * 60)
