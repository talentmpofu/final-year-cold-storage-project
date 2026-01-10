"""
Automated Produce Detection Model Training - APPLES & POTATOES
Just place your images and labels in the dataset folder and run this script!
"""

from ultralytics import YOLO
import os
from pathlib import Path

print("=" * 70)
print("🍎🥔 APPLES & POTATOES DETECTION - AUTOMATED TRAINING")
print("=" * 70)

# Check dataset structure
dataset_path = Path("dataset")
train_images = dataset_path / "train" / "images"
train_labels = dataset_path / "train" / "labels"
valid_images = dataset_path / "valid" / "images"
valid_labels = dataset_path / "valid" / "labels"

print("\n📁 Checking dataset structure...")

# Create folders if they don't exist
for folder in [train_images, train_labels, valid_images, valid_labels]:
    folder.mkdir(parents=True, exist_ok=True)
    print(f"  ✓ {folder}")

# Count images
train_count = len(list(train_images.glob("*.jpg"))) + len(list(train_images.glob("*.png")))
valid_count = len(list(valid_images.glob("*.jpg"))) + len(list(valid_images.glob("*.png")))

print(f"\n📊 Dataset Summary:")
print(f"  Training images: {train_count}")
print(f"  Validation images: {valid_count}")

if train_count == 0:
    print("\n❌ ERROR: No training images found!")
    print("\n📋 Instructions:")
    print("1. Place your apple images in: dataset/train/images/")
    print("2. Place apple labels in: dataset/train/labels/")
    print("3. Place your potato images in: dataset/train/images/")
    print("4. Place potato labels in: dataset/train/labels/")
    print("5. Place validation images in: dataset/valid/images/")
    print("6. Place validation labels in: dataset/valid/labels/")
    print("\n💡 Label format (YOLO): Each .txt file should contain:")
    print("   <class_id> <x_center> <y_center> <width> <height>")
    print("   Class 0 = apples, Class 1 = potatoes")
    print("   Example: 0 0.5 0.5 0.8 0.8  (for an apple)")
    exit(1)

if valid_count == 0:
    print("\n⚠️  Warning: No validation images!")
    print("Continuing anyway (not recommended for best results)")

print("\n" + "=" * 70)
print("🚀 STARTING TRAINING")
print("=" * 70)

# Training configuration
CONFIG = {
    'data': 'dataset/data.yaml',
    'epochs': 100,           # Number of training cycles
    'imgsz': 640,           # Image size
    'batch': 16,            # Batch size (reduce if out of memory)
    'patience': 20,         # Stop if no improvement for 20 epochs
    'device': 'cpu',        # Use 'cuda' if you have GPU
    'workers': 4,
    'project': 'runs/detect',
    'name': 'apple_detector',
    'exist_ok': True,
}

print("\n📋 Training Configuration:")
for key, value in CONFIG.items():
    print(f"  {key}: {value}")

print("\n⏱️  Estimated time:")
print("  - CPU: 2-4 hours")
print("  - GPU: 20-40 minutes")
print("\n💡 You can stop training anytime with Ctrl+C")
print("   The best model will be saved automatically\n")

input("Press ENTER to start training... ")

try:
    # Load base model
    model = YOLO('yolov8n.pt')  # Start with YOLOv8 nano (smallest, fastest)
    
    # Train
    results = model.train(
        data=CONFIG['data'],
        epochs=CONFIG['epochs'],
        imgsz=CONFIG['imgsz'],
        batch=CONFIG['batch'],
        patience=CONFIG['patience'],
        device=CONFIG['device'],
        workers=CONFIG['workers'],
        project=CONFIG['project'],
        name=CONFIG['name'],
        exist_ok=CONFIG['exist_ok'],
    )
    
    print("\n" + "=" * 70)
    print("✅ TRAINING COMPLETE!")
    print("=" * 70)
    
    # Find best model
    best_model = Path(CONFIG['project']) / CONFIG['name'] / 'weights' / 'best.pt'
    
    if best_model.exists():
        # Copy to main folder
        import shutil
        dest = Path("produce_model.pt")
        shutil.copy(best_model, dest)
        
        print(f"\n✅ Best model saved to: {dest.absolute()}")
        print(f"📊 Training results: {Path(CONFIG['project']) / CONFIG['name']}")
        
        print("\n🎉 Your apples & potatoes detection model is ready!")
        print("\n📋 Next steps:")
        print("1. Restart the YOLO server: python yolo_server.py")
        print("2. Test with ESP32-CAM images")
        print("3. System will auto-detect apples or potatoes and adjust storage")
        
    else:
        print("\n⚠️  Training completed but best model not found")
        print(f"Check: {Path(CONFIG['project']) / CONFIG['name']}")
        
except KeyboardInterrupt:
    print("\n\n⚠️  Training interrupted by user")
    print("Partial progress has been saved")
    
except Exception as e:
    print(f"\n\n❌ Error during training: {e}")
    print("\nTroubleshooting:")
    print("1. Check dataset/data.yaml exists")
    print("2. Verify images and labels match (same filenames)")
    print("3. Reduce batch size if out of memory")
    
print("\n" + "=" * 70)
