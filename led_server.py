from flask import Flask, request, jsonify
from flask_cors import CORS
from rgbmatrix import RGBMatrix, RGBMatrixOptions
from PIL import Image, ImageDraw
import threading
import time
import io
import base64
import os

# Nettoyage automatique du port au lancement
os.system("sudo fuser -k 5000/tcp > /dev/null 2>&1")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024
CORS(app)

lock = threading.Lock()

# --- CONFIG MATRICE LED ---
options = RGBMatrixOptions()
options.rows = 64
options.cols = 64
options.chain_length = 2
options.hardware_mapping = 'adafruit-hat'
options.gpio_slowdown = 4
matrix = RGBMatrix(options = options)

# --- VARIABLES GLOBALES ---
current_layout = {"layers": []}
decoded_assets = {}  # Stockage des images PIL
layer_state = {}     # Stockage des index de frames (proposé par Lovable)

def decode_base64_img(data_url, w, h):
    try:
        if "," in data_url:
            data_url = data_url.split(",")[1]
        img_bytes = base64.b64decode(data_url)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        return img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
    except Exception as e:
        print(f"❌ Erreur décodage : {e}")
        return None

def engine_loop():
    offscreen_canvas = matrix.CreateFrameCanvas()

    while True:
        frame_start = time.monotonic()

        # Création du canevas de base (fond noir 128x64)
        base_img = Image.new('RGB', (128, 64), (0, 0, 0))

        # Lecture thread-safe des données partagées avec le serveur Flask
        with lock:
            layout = current_layout
            assets = decoded_assets
            states = layer_state

        # Dessin de chaque layer sur le canevas
        for layer in layout.get("layers", []):
            try:
                layer_id = layer.get('id') or layer.get('type', 'unknown')
                x = int(float(layer.get('x', 0)))
                y = int(float(layer.get('y', 0)))

                # CAS 1 : MÉDIA ANIMÉ (Multi-frames)
                if layer.get("type") == "media" and "frames" in layer:
                    state = states.get(layer_id)
                    if state:
                        fps = layer.get("fps", 12)
                        frame_duration = 1.0 / fps
                        now = time.monotonic()

                        # Changement de frame si le délai est passé
                        if now - state["last_frame_time"] >= frame_duration:
                            state["frame_index"] = (state["frame_index"] + 1) % len(layer["frames"])
                            state["last_frame_time"] = now

                        # Récupération de l'image décodée correspondante
                        frames_list = assets.get(f"{layer_id}_frames", [])
                        if frames_list:
                            current_frame = frames_list[state["frame_index"]]
                            if current_frame:
                                base_img.paste(current_frame, (x, y))

                # CAS 2 : IMAGE STATIQUE
                elif layer.get('data') and layer.get('type') != 'text':
                    img_static = assets.get(f"{layer_id}_static")
                    if img_static is not None:
                        base_img.paste(img_static, (x, y))

                # CAS 3 : TEXTE
                elif layer.get('type') == 'text':
                    draw = ImageDraw.Draw(base_img)
                    content = layer.get('content', '')
                    color = tuple(layer.get('color', [255, 255, 255]))
                    draw.text((x, y), content, fill=color)

            except Exception as e:
                # print(f"Erreur rendu : {e}")
                pass

        # Envoi du canevas final sur la matrice physique
        offscreen_canvas.Clear()
        offscreen_canvas.SetImage(base_img)
        offscreen_canvas = matrix.SwapOnVSync(offscreen_canvas)

        # Attente pour maintenir ~30fps (en tenant compte du temps de rendu)
        elapsed = time.monotonic() - frame_start
        time.sleep(max(0, 0.033 - elapsed))

@app.route('/api/layout', methods=['POST'])
def update_layout():
    global current_layout, decoded_assets, layer_state
    payload = request.get_json()
    new_assets = {}

    # 1. Détection du besoin de Reset
    should_reset = bool(payload.get("reset")) or any(
        bool(l.get("reset")) for l in payload.get("layers", [])
    )

    # 2. Prétraitement des layers et décodage
    for layer in payload.get("layers", []):
        layer_id = layer.get("id") or layer.get("type", "unknown")
        w, h = layer.get('w', 128), layer.get('h', 64)

        # Décodage des frames si c'est une animation
        if layer.get("type") == "media" and layer.get("frames"):
            new_assets[f"{layer_id}_frames"] = [decode_base64_img(f, w, h) for f in layer["frames"]]
            
            # Gestion du RESET de l'index
            if should_reset or layer.get("reset") or layer_id not in layer_state:
                start_idx = int(layer.get("start_index", 0))
                layer_state[layer_id] = {
                    "frame_index": start_idx if start_idx < len(layer["frames"]) else 0,
                    "last_frame_time": time.monotonic(),
                }
        
        # Décodage image statique
        elif layer.get('data'):
            new_assets[f"{layer_id}_static"] = decode_base64_img(layer['data'], w, h)

    with lock:
        decoded_assets = new_assets
        current_layout = payload
    
    print(f"📥 Layout reçu (Reset: {should_reset})")
    return jsonify({"status": "success", "ok": True}), 200

if __name__ == '__main__':
    # Lancement du moteur de rendu dans un thread séparé
    threading.Thread(target=engine_loop, daemon=True).start()
    # Lancement du serveur API
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)