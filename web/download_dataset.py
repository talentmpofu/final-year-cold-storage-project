"""
Download and prepare dataset for training
Creates dataset structure for manual data collection
"""

import os
import yaml

print("=" * 60)
print("Dataset Preparation")
print("=" * 60)

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
    create_sample_dataset()
    
    print("\n🎯 Dataset structure ready!")
    print("\nYou can now:")
    print("1. Collect images with ESP32-CAM")
    print("2. Use Roboflow to label them")
    print("3. Or download existing datasets from Kaggle/Roboflow")
    print("\nOnce you have images and labels, run:")
    print("   python train_model.py")
