#!/usr/bin/env python3
"""
YOLO Inference Server for Cold Storage Produce Detection
Detects apples and potatoes from ESP32-CAM images
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
from ultralytics import YOLO
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

INFERENCE_PROVIDER = str(os.getenv("INFERENCE_PROVIDER", "local")).strip().lower()
LOCAL_MODEL_PATH = os.getenv("LOCAL_MODEL_PATH", "produce_model.pt")
FALLBACK_MODEL_PATH = os.getenv("FALLBACK_MODEL_PATH", "yolo11x.pt")

UPLOAD_FOLDER = "inference_uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def normalize_label(label: str) -> str:
    return str(label or "").strip().lower().replace("-", "_").replace(" ", "_")


def extract_primary_produce(label: str):
    normalized = normalize_label(label)
    if "apple" in normalized:
        return "apples"
    if "potato" in normalized:
        return "potatoes"
    return None


def resolve_class_name(model_obj, class_id: int) -> str:
    names = getattr(model_obj, "names", None)
    if isinstance(names, dict):
        return str(names.get(class_id, f"class_{class_id}"))
    if isinstance(names, list) and 0 <= class_id < len(names):
        return str(names[class_id])
    return f"class_{class_id}"


def load_local_model():
    """
    Load local YOLO model for LOCAL inference mode.
    In Roboflow mode, local model loading is optional and skipped.
    """
    if INFERENCE_PROVIDER == "roboflow":
        print("ℹ️  INFERENCE_PROVIDER=roboflow -> local YOLO model load skipped")
        return None

    for candidate_path, label in [
        (LOCAL_MODEL_PATH, "configured local model"),
        (FALLBACK_MODEL_PATH, "fallback local model"),
    ]:
        if not os.path.exists(candidate_path):
            continue
        try:
            loaded = YOLO(candidate_path)
            print(f"✓ Loaded {label}: {candidate_path}")
            return loaded
        except Exception as err:
            print(f"⚠️  Failed to load {label} ({candidate_path}): {err}")

    print("⚠️  No local YOLO model available. Local /detect is disabled.")
    return None

model = load_local_model()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'inference_provider': INFERENCE_PROVIDER,
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
        if model is None:
            return jsonify({
                'success': False,
                'error': 'Local YOLO model not loaded. Use Roboflow provider or configure LOCAL_MODEL_PATH.'
            }), 503

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

                raw_label = resolve_class_name(model, class_id).lower()
                produce_name = normalize_label(raw_label)
                primary_produce = extract_primary_produce(produce_name)

                detections.append({
                    'type': produce_name,
                    'primary_type': primary_produce,
                    'confidence': confidence,
                    'bbox': box.xyxy[0].tolist()
                })

                # Track highest-confidence primary produce detection only
                if primary_produce and confidence > highest_confidence:
                    highest_confidence = confidence
                    detected_produce = primary_produce
        
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
            '1. Collect images of apples and potatoes',
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
                'nc': 4,
                'names': ['good_apple', 'good_potato', 'bad_apple', 'bad_potato']
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
    print(f"🧠 Inference provider: {INFERENCE_PROVIDER}")
    print(f"📊 Endpoints:")
    print(f"   POST /detect - Detect produce from image")
    print(f"   GET  /health - Health check")
    print(f"   GET  /train-info - Training guide")
    print(f"\n⚙️  Waiting for inference requests...\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False)
