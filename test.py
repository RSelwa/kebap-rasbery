import board
import neopixel
import time

# On définit la grille : 800 LEDs (20 x 40)
pixels = neopixel.NeoPixel(board.D18, 800, brightness=0.2)

print("Allumage en ROUGE...")
pixels.fill((255, 0, 0)) # Rouge
time.sleep(2)

print("Allumage en VERT...")
pixels.fill((0, 255, 0)) # Vert
time.sleep(2)

print("Extinction.")
pixels.fill((0, 0, 0))
