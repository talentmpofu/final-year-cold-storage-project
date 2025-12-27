#!/usr/bin/env python3
"""
YOLO Inference Server for Cold Storage Produce Detection
Detects apples, tomatoes, and potatoes from ESP32-CAM images
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
from ultralytics import YOLO
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Load YOLO model
MODEL_PATH = "produce_model.pt"  # Path to your trained YOLO model
UPLOAD_FOLDER = "inference_uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Class mapping for produce types
PRODUCE_CLASSES = {
    0: 'apples',
    1: 'tomatoes', 
    2: 'potatoes'
}

# Load model (will be trained with your custom dataset)
try:
    model = YOLO(MODEL_PATH)
    print(f"✓ YOLO model loaded from {MODEL_PATH}")
except Exception as e:
    print(f"⚠️  Warning: Could not load model from {MODEL_PATH}")
    print(f"   Using YOLOv8n as placeholder. Train your model with produce dataset!")
    model = YOLO('yolov8n.pt')  # Fallback to pretrained model

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': model is not None,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/detect', methods=['POST'])
def detect_produce():
    """
    Detect produce type from uploaded image
    Expected: multipart/form-data with 'image' file
    Returns: JSON with detected produce type and confidence
    """
    try:
        # Check if image was uploaded
        if 'image' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No image file provided'
            }), 400
        
        image_file = request.files['image']
        
        # Save uploaded image
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"produce_{timestamp}.jpg"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        image_file.save(filepath)
        
        print(f"📸 Processing image: {filename}")
        
        # Read image with OpenCV
        img = cv2.imread(filepath)
        if img is None:
            return jsonify({
                'success': False,
                'error': 'Invalid image file'
            }), 400
        
        # Run YOLO inference
        results = model(img, verbose=False)
        
        # Parse results
        detected_produce = None
        highest_confidence = 0.0
        detections = []
        
        for result in results:
            boxes = result.boxes
            for box in boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                
                # Map class ID to produce name
                if class_id in PRODUCE_CLASSES:
                    produce_name = PRODUCE_CLASSES[class_id]
                    detections.append({
                        'type': produce_name,
                        'confidence': confidence,
                        'bbox': box.xyxy[0].tolist()
                    })
                    
                    # Track highest confidence detection
                    if confidence > highest_confidence:
                        highest_confidence = confidence
                        detected_produce = produce_name
        
        # If no produce detected with sufficient confidence
        if detected_produce is None or highest_confidence < 0.5:
            print(f"⚠️  No produce detected with sufficient confidence")
            return jsonify({
                'success': True,
                'detected': None,
                'confidence': 0.0,
                'message': 'No produce detected with sufficient confidence (>50%)',
                'all_detections': detections
            })
        
        print(f"✓ Detected: {detected_produce} (confidence: {highest_confidence:.2%})")
        
        return jsonify({
            'success': True,
            'detected': detected_produce,
            'confidence': highest_confidence,
            'all_detections': detections,
            'image_path': filepath
        })
        
    except Exception as e:
        print(f"❌ Error during inference: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/train-info', methods=['GET'])
def training_info():
    """
    Provide information about training your custom YOLO model
    """
    return jsonify({
        'message': 'Train your YOLO model with custom produce dataset',
        'steps': [
            '1. Collect images of apples, tomatoes, and potatoes',
            '2. Annotate images using tools like Roboflow or LabelImg',
            '3. Organize dataset: train/images, train/labels, val/images, val/labels',
            '4. Create data.yaml with class names and paths',
            '5. Train: yolo train model=yolov8n.pt data=data.yaml epochs=100',
            '6. Replace produce_model.pt with your trained model',
            '7. Restart this server'
        ],
        'dataset_structure': {
            'train': ['images/', 'labels/'],
            'val': ['images/', 'labels/'],
            'data.yaml': {
                'train': './train/images',
                'val': './val/images',
                'nc': 3,
                'names': ['apples', 'tomatoes', 'potatoes']
            }
        },
        'recommended_images': 'At least 100 images per class for good accuracy'
    })

if __name__ == '__main__':
    print("╔═══════════════════════════════════════╗")
    print("║  YOLO Inference Server                ║")
    print("║  Cold Storage Produce Detection       ║")
    print("╚═══════════════════════════════════════╝")
    print(f"\n✓ Server starting on port 5000")
    print(f"📊 Endpoints:")
    print(f"   POST /detect - Detect produce from image")
    print(f"   GET  /health - Health check")
    print(f"   GET  /train-info - Training guide")
    print(f"\n⚙️  Waiting for inference requests...\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False)
