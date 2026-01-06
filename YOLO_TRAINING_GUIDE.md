# YOLO Model Training Guide for Produce Detection

## Overview
Train a custom YOLOv8 model to detect and classify fresh vs spoiled produce (apples, tomatoes, potatoes).

## Dataset Preparation

### Option 1: Download Existing Datasets

#### Step 1: Download Datasets from Kaggle

**Requirements:**
```bash
pip install kaggle
```

**Download Fruit Fresh/Rotten Dataset:**
```bash
# Get Kaggle API key from https://www.kaggle.com/settings/account
# Download kaggle.json and place it in C:\Users\YourName\.kaggle\

kaggle datasets download -d sriramr/fruits-fresh-and-rotten-for-classification
kaggle datasets download -d misrakahmed/vegetable-image-dataset
```

#### Step 2: Convert to YOLO Format

Your dataset structure should look like:
```
dataset/
├── train/
│   ├── images/
│   │   ├── image1.jpg
│   │   ├── image2.jpg
│   └── labels/
│       ├── image1.txt
│       ├── image2.txt
├── valid/
│   ├── images/
│   └── labels/
└── data.yaml
```

**Label format (YOLO):** Each `.txt` file contains:
```
<class_id> <x_center> <y_center> <width> <height>
```
All values normalized 0-1.

### Option 2: Use Roboflow (Easiest Method)

#### Step 1: Create Roboflow Account
1. Go to https://roboflow.com/
2. Sign up (free tier available)
3. Create new project: "Cold Storage Produce Detection"
4. Project type: Object Detection

#### Step 2: Upload Images
1. Upload your produce images
2. Or search public datasets: https://universe.roboflow.com/
   - "Fruit and Vegetable Detection"
   - "Rotten Fruit Detection"
   - "Tomato Disease Detection"

#### Step 3: Label Your Data
1. Use Roboflow's annotation tool
2. Create classes:
   - `apple_fresh`
   - `apple_spoiled`
   - `tomato_fresh`
   - `tomato_spoiled`
   - `potato_fresh`
   - `potato_spoiled`

#### Step 4: Generate Dataset
1. Click "Generate New Version"
2. Preprocessing:
   - Auto-Orient: ✅
   - Resize: 640x640 (YOLO standard)
3. Augmentation (to increase dataset size):
   - Flip: Horizontal
   - Rotation: ±15°
   - Brightness: ±15%
   - Exposure: ±15%
4. Export Format: **YOLOv8**
5. Download dataset

### Option 3: Collect Your Own Data (Highly Recommended)

**Why?** Your ESP32-CAM has specific characteristics that affect detection.

#### Collection Strategy:

**Week 1-2: Capture Fresh Produce**
```python
# Take photos every day of fresh produce
- 50 photos of fresh apples (different angles)
- 50 photos of fresh tomatoes
- 50 photos of fresh potatoes
```

**Week 3-4: Track Spoilage**
```python
# Take photos as produce ages
- Day 1 (fresh)
- Day 3 (slightly aged)
- Day 5 (beginning to spoil)
- Day 7 (clearly spoiled)
```

**Capture Variations:**
- ✅ Different quantities (1, 3, 5+ items)
- ✅ Different lighting (day/night, flash on/off)
- ✅ Different positions/angles
- ✅ Different backgrounds

## Training the Model

### Step 1: Install Dependencies

```bash
cd "C:\Users\talen\Desktop\Cold storage unit\web"
pip install ultralytics opencv-python pillow roboflow
```

### Step 2: Create Training Script

Create `train_model.py`:

```python
from ultralytics import YOLO
import os

# Load a pretrained YOLOv8 model (use 'n' for nano, fastest on CPU)
model = YOLO('yolov8n.pt')

# Train the model
results = model.train(
    data='dataset/data.yaml',  # Path to your data.yaml
    epochs=100,                # Number of training epochs
    imgsz=640,                 # Image size
    batch=16,                  # Batch size (reduce if out of memory)
    name='produce_detector',   # Experiment name
    patience=20,               # Early stopping patience
    device='cpu',              # Use 'cuda' if you have GPU
    
    # Optimization for small dataset
    augment=True,
    mosaic=1.0,
    mixup=0.1,
    
    # Save best model
    save=True,
    save_period=10,
)

print("Training complete!")
print(f"Best model saved at: runs/detect/produce_detector/weights/best.pt")
```

### Step 3: Create data.yaml

Create `dataset/data.yaml`:

```yaml
# Dataset paths
path: C:/Users/talen/Desktop/Cold storage unit/web/dataset
train: train/images
val: valid/images

# Classes
names:
  0: apple_fresh
  1: apple_spoiled
  2: tomato_fresh
  3: tomato_spoiled
  4: potato_fresh
  5: potato_spoiled
```

### Step 4: Run Training

```bash
python train_model.py
```

**Training Time:**
- CPU: 2-4 hours for 100 epochs
- GPU: 20-30 minutes for 100 epochs

### Step 5: Monitor Training

Watch for:
- ✅ mAP (mean Average Precision) > 0.7 is good
- ✅ Loss decreasing over time
- ✅ Validation metrics improving

Results saved in: `runs/detect/produce_detector/`

## Testing Your Model

Create `test_model.py`:

```python
from ultralytics import YOLO
from PIL import Image
import cv2

# Load your trained model
model = YOLO('runs/detect/produce_detector/weights/best.pt')

# Test on a single image
results = model('test_image.jpg')

# Display results
for result in results:
    boxes = result.boxes
    for box in boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        print(f"Detected: {model.names[cls]} (confidence: {conf:.2f})")
    
    # Save annotated image
    result.save('result.jpg')
```

## Integrating with Your System

### Step 1: Replace Model in yolo_server.py

```python
from ultralytics import YOLO
import os

# Try to load custom model, fallback to default
model_path = 'runs/detect/produce_detector/weights/best.pt'
if os.path.exists(model_path):
    model = YOLO(model_path)
    print("✅ Loaded custom produce detection model")
else:
    model = YOLO('yolov8n.pt')
    print("⚠️ Using default YOLO model")
```

### Step 2: Update Class Mapping

Update `yolo_server.py` to map detections to produce types:

```python
# Class ID to produce type mapping
PRODUCE_MAPPING = {
    0: 'apples',      # apple_fresh
    1: 'apples',      # apple_spoiled (still apples)
    2: 'tomatoes',    # tomato_fresh
    3: 'tomatoes',    # tomato_spoiled
    4: 'potatoes',    # potato_fresh
    5: 'potatoes',    # potato_spoiled
}

SPOILAGE_STATUS = {
    0: 'fresh',
    1: 'spoiled',
    2: 'fresh',
    3: 'spoiled',
    4: 'fresh',
    5: 'spoiled',
}

# In detection endpoint
detected_class = int(boxes[0].cls[0])
produce_type = PRODUCE_MAPPING.get(detected_class, 'unknown')
spoilage = SPOILAGE_STATUS.get(detected_class, 'unknown')

return jsonify({
    'produce': produce_type,
    'status': spoilage,
    'confidence': float(boxes[0].conf[0])
})
```

## Dataset Quality Tips

### For Best Results:

**Image Quality:**
- ✅ Use same camera (ESP32-CAM) for training data
- ✅ Same resolution (1600x1200 UXGA)
- ✅ Same lighting conditions as deployment
- ✅ Include actual cold storage background

**Labeling Tips:**
- ✅ Tight bounding boxes
- ✅ Label partially visible items
- ✅ Consistent class definitions
- ✅ At least 200 images per class (fresh + spoiled)

**Spoilage Indicators:**
- 🍎 Apples: Brown spots, wrinkled skin, soft texture
- 🍅 Tomatoes: Dark spots, mold, skin cracking, mushiness
- 🥔 Potatoes: Green skin, sprouts, soft spots, wrinkles

## Recommended Training Strategy

### Phase 1: Basic Classification (Week 1)
1. Collect 50-100 images per produce type (fresh only)
2. Train basic classifier
3. Test accuracy

### Phase 2: Spoilage Detection (Week 2-3)
1. Let produce age naturally
2. Photograph at different decay stages
3. Add spoiled images to dataset
4. Retrain model

### Phase 3: Fine-tuning (Week 4)
1. Test in actual cold storage
2. Collect edge cases (unusual lighting, angles)
3. Add to dataset
4. Final training

## Quick Start with Pre-made Dataset

If you want to start immediately, use this Roboflow public dataset:

```python
from roboflow import Roboflow

rf = Roboflow(api_key="YOUR_API_KEY")
project = rf.workspace("produce-detection").project("fruit-spoilage")
dataset = project.version(1).download("yolov8")

# This downloads ready-to-use YOLO format dataset
# Train with: python train_model.py
```

## Expected Performance

**Good Model Metrics:**
- mAP50: > 0.80 (80% accuracy at 50% IoU threshold)
- Precision: > 0.75
- Recall: > 0.75
- Inference time: < 100ms per image

**Real-world Testing:**
- Test with actual produce in your cold storage
- Test under different lighting
- Test with multiple items
- Test edge cases (partially hidden items)

## Troubleshooting

**Low Accuracy:**
- ✅ Need more training data (aim for 200+ per class)
- ✅ Increase augmentation
- ✅ Train longer (more epochs)
- ✅ Use larger model (yolov8s instead of yolov8n)

**Overfitting:**
- ✅ Add more variety to training data
- ✅ Increase augmentation
- ✅ Reduce epochs
- ✅ Add dropout/regularization

**Slow Inference:**
- ✅ Use smaller model (yolov8n is fastest)
- ✅ Reduce image size
- ✅ Use GPU if available

## Next Steps

1. Choose dataset strategy (existing + custom is best)
2. Collect/download images
3. Label data using Roboflow
4. Train model with training script
5. Test on validation set
6. Deploy to yolo_server.py
7. Test with ESP32-CAM in real environment

Let me know which approach you'd like to take!
