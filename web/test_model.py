"""
Test the trained YOLO model
"""

from ultralytics import YOLO
import cv2
import os
from pathlib import Path

print("=" * 60)
print("Model Testing Script")
print("=" * 60)

# Find the best trained model
model_paths = [
    'runs/detect/produce_detector/weights/best.pt',
    'produce_model.pt',
    'yolov8n.pt'  # fallback to default
]

model_path = None
for path in model_paths:
    if os.path.exists(path):
        model_path = path
        break

if not model_path:
    print("❌ No model found!")
    print("Please train a model first: python train_model.py")
    exit(1)

print(f"\n📦 Loading model: {model_path}")
model = YOLO(model_path)

print("\n✅ Model loaded successfully!")
print(f"   Classes: {model.names}")

def test_image(image_path):
    """Test model on a single image"""
    
    if not os.path.exists(image_path):
        print(f"❌ Image not found: {image_path}")
        return
    
    print(f"\n🔍 Testing: {image_path}")
    
    # Run inference
    results = model(image_path, conf=0.25)
    
    # Process results
    for result in results:
        boxes = result.boxes
        
        if len(boxes) == 0:
            print("   No objects detected")
            continue
        
        print(f"   Detected {len(boxes)} object(s):")
        
        for box in boxes:
            cls = int(box.cls[0])
            conf = float(box.conf[0])
            class_name = model.names[cls]
            
            print(f"   - {class_name}: {conf:.2%} confidence")
        
        # Save annotated image
        output_path = f"test_result_{Path(image_path).stem}.jpg"
        result.save(output_path)
        print(f"   💾 Saved result: {output_path}")

def test_webcam():
    """Test model with webcam (if available)"""
    
    print("\n📷 Testing with webcam...")
    print("Press 'q' to quit")
    
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("❌ Could not open webcam")
        return
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Run inference
        results = model(frame, conf=0.25)
        
        # Annotate frame
        annotated_frame = results[0].plot()
        
        # Display
        cv2.imshow('YOLO Detection', annotated_frame)
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    
    cap.release()
    cv2.destroyAllWindows()

def batch_test(folder_path):
    """Test on all images in a folder"""
    
    if not os.path.exists(folder_path):
        print(f"❌ Folder not found: {folder_path}")
        return
    
    print(f"\n📁 Testing all images in: {folder_path}")
    
    # Get all image files
    image_extensions = ['.jpg', '.jpeg', '.png', '.bmp']
    image_files = []
    
    for ext in image_extensions:
        image_files.extend(Path(folder_path).glob(f'*{ext}'))
    
    if not image_files:
        print("   No images found")
        return
    
    print(f"   Found {len(image_files)} images")
    
    # Test each image
    for img_path in image_files:
        test_image(str(img_path))

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("Test Options:")
    print("=" * 60)
    print("1. Test single image")
    print("2. Test folder of images")
    print("3. Test with webcam")
    print("4. Test with sample images from dataset")
    
    choice = input("\nEnter choice (1-4): ").strip()
    
    if choice == '1':
        img_path = input("Enter image path: ").strip()
        test_image(img_path)
    
    elif choice == '2':
        folder_path = input("Enter folder path: ").strip()
        batch_test(folder_path)
    
    elif choice == '3':
        test_webcam()
    
    elif choice == '4':
        # Test with validation images
        val_folder = 'dataset/valid/images'
        if os.path.exists(val_folder):
            batch_test(val_folder)
        else:
            print(f"❌ Validation folder not found: {val_folder}")
            print("Please prepare dataset first")
    
    else:
        print("Invalid choice")
    
    print("\n✅ Testing complete!")
