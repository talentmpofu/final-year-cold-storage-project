"""
YOLO Model Training Script for Produce Detection
Trains a custom YOLOv8 model to detect and classify fresh vs spoiled produce
"""

from ultralytics import YOLO
import os
import sys

print("=" * 60)
print("Cold Storage Produce Detection - Model Training")
print("=" * 60)

# Configuration
CONFIG = {
    'model_size': 'yolov8n.pt',      # nano model (fastest, smallest)
    'epochs': 100,                    # training epochs
    'imgsz': 640,                     # image size
    'batch': 16,                      # batch size (reduce if out of memory)
    'patience': 20,                   # early stopping patience
    'device': 'cpu',                  # 'cpu' or 'cuda' for GPU
    'workers': 4,                     # number of dataloader workers
    'project': 'runs/detect',         # where to save results
    'name': 'produce_detector',       # experiment name
}

def check_dataset():
    """Check if dataset exists"""
    data_yaml = 'dataset/data.yaml'
    
    if not os.path.exists(data_yaml):
        print("\n❌ Dataset not found!")
        print(f"Expected: {os.path.abspath(data_yaml)}")
        print("\nPlease prepare your dataset first:")
        print("1. Run: python download_dataset.py")
        print("2. Or manually create dataset/data.yaml")
        return False
    
    print(f"✅ Found dataset: {os.path.abspath(data_yaml)}")
    return True

def train_model():
    """Train the YOLO model"""
    
    print("\n📊 Training Configuration:")
    for key, value in CONFIG.items():
        print(f"  {key}: {value}")
    
    print("\n🚀 Starting training...")
    print("This may take 2-4 hours on CPU, or 20-30 minutes on GPU\n")
    
    # Load pretrained model
    model = YOLO(CONFIG['model_size'])
    
    # Train the model
    results = model.train(
        data='dataset/data.yaml',
        epochs=CONFIG['epochs'],
        imgsz=CONFIG['imgsz'],
        batch=CONFIG['batch'],
        name=CONFIG['name'],
        patience=CONFIG['patience'],
        device=CONFIG['device'],
        workers=CONFIG['workers'],
        
        # Data augmentation
        augment=True,
        hsv_h=0.015,      # HSV-Hue augmentation
        hsv_s=0.7,        # HSV-Saturation augmentation
        hsv_v=0.4,        # HSV-Value augmentation
        degrees=15,       # rotation augmentation
        translate=0.1,    # translation augmentation
        scale=0.5,        # scaling augmentation
        flipud=0.0,       # flip up-down probability
        fliplr=0.5,       # flip left-right probability
        mosaic=1.0,       # mosaic augmentation probability
        mixup=0.1,        # mixup augmentation probability
        
        # Save settings
        save=True,
        save_period=10,   # save checkpoint every N epochs
        plots=True,       # save training plots
        
        # Optimization
        optimizer='Adam',
        lr0=0.001,        # initial learning rate
        momentum=0.937,   # SGD momentum/Adam beta1
        weight_decay=0.0005,
    )
    
    print("\n" + "=" * 60)
    print("✅ Training Complete!")
    print("=" * 60)
    
    # Display results location
    model_path = f"{CONFIG['project']}/{CONFIG['name']}/weights/best.pt"
    print(f"\n📦 Best model saved at:")
    print(f"   {os.path.abspath(model_path)}")
    
    print(f"\n📊 Training results:")
    results_path = f"{CONFIG['project']}/{CONFIG['name']}"
    print(f"   {os.path.abspath(results_path)}")
    
    print("\n📈 Key Metrics:")
    try:
        # Try to read and display final metrics
        metrics = results.results_dict
        if metrics:
            print(f"   mAP50: {metrics.get('metrics/mAP50(B)', 0):.3f}")
            print(f"   Precision: {metrics.get('metrics/precision(B)', 0):.3f}")
            print(f"   Recall: {metrics.get('metrics/recall(B)', 0):.3f}")
    except:
        print("   (Check results folder for detailed metrics)")
    
    return model_path

def validate_model(model_path):
    """Validate the trained model"""
    print("\n🔍 Validating model...")
    
    model = YOLO(model_path)
    results = model.val()
    
    print("\n✅ Validation complete!")
    return results

if __name__ == "__main__":
    print("\n🔍 Step 1: Checking dataset...")
    
    if not check_dataset():
        print("\n❌ Cannot proceed without dataset")
        sys.exit(1)
    
    print("\n🎯 Step 2: Training model...")
    model_path = train_model()
    
    print("\n📋 Step 3: Validating model...")
    validate_model(model_path)
    
    print("\n" + "=" * 60)
    print("🎉 All done!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Test model: python test_model.py")
    print("2. Copy model to web folder for deployment")
    print(f"   Copy: {model_path}")
    print(f"   To: web/produce_model.pt")
