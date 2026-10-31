"""Genera con ElevenLabs la voz que guia la prueba de ojos y la musica del minuto quieto.

Quedan grabadas en src/static/assets/voz-ojos/ y se sirven como archivos: no se paga ElevenLabs en
cada consulta. La voz es la del medico virtual (Alirio, la misma de scripts/agente-avatar/sync.py),
para que la prueba y la entrevista suenen a la misma persona.

    python scripts/voz-ojos/generar.py            # genera solo los que faltan
    python scripts/voz-ojos/generar.py --todo     # regenera todo (p. ej. tras cambiar un texto)
    python scripts/voz-ojos/generar.py fatiga fin # regenera esos

Los ids son los que pide src/static/js/guia-voz.js; si se agrega uno, agregarlo alla tambien.
"""
import os
import subprocess
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[2]
load_dotenv(RAIZ / '.env')

KEY = os.getenv('ELEVENLABS_API_KEY')
if not KEY:
    sys.exit('Falta ELEVENLABS_API_KEY')

SALIDA = RAIZ / 'src' / 'static' / 'assets' / 'voz-ojos'
VOZ = 'nPwdEe2zxbAbdkRLsG5T'   # Alirio
MODELO = 'eleven_v4_turbo'

# De tu, como el medico. Frases cortas: el paciente esta mirando la camara, no la pantalla.
TEXTOS = {
    'intro': 'Hola. Antes de hablar con el asistente virtual, vamos a revisar tus ojos con la cámara. '
             'Son unos dos minutos y yo te voy guiando.',
    'tamizaje': 'Primero voy a tomar una foto de tus ojos. Sostén el celular frente a tu cara, a un palmo '
                'de distancia, con buena luz de frente, y mira la cámara. Yo te voy diciendo si te acercas o '
                'te alejas. Cuando estés bien te aviso: te quedas quieto y la foto se toma sola.',
    'acercate': 'Acerca un poco más el celular a tu cara.',
    'alejate': 'Aleja un poco el celular.',
    'abre-ojos': 'Abre bien los ojos.',
    'quieto': 'Quédate quieto un momento.',
    'un-poco-mas': 'Eso, un poco más cerca.',
    'perfecto': 'Así está perfecto. Quédate quieto.',
    'boton-foto': 'Si te cuesta, toca el botón azul que dice: Tomar la foto.',
    'no-te-veo': 'No veo tu cara. Ponla frente a la cámara.',
    'foto-lista': 'Listo, ya tenemos la foto.',
    'fatiga': 'Ahora viene un minuto de música. Mientras suene, mira la cámara, parpadea normal y '
              'quédate quieto, sin hablar. Empezamos.',
    # Durante el minuto: que sepa que se esta midiendo y para que
    'fatiga-que': 'Te cuento qué hacemos: estamos midiendo cómo parpadeas, cuántas veces y qué tan '
                  'rápido. Eso nos dice si tus ojos están cansados o resecos.',
    'faltan-30': 'Vas muy bien. Faltan treinta segundos.',
    'fatiga-casi': 'Ya casi terminamos. Sigue mirando la cámara.',
    'pupilas': 'Muy bien. Por último, vamos a mirar tus pupilas. La pantalla va a cambiar de color: '
               'mientras suene la música, mira el punto del centro sin apartar la vista.',
    # Cada uno tiene que terminar antes de la ventana de medicion que sigue (ver ojos.js)
    'pupilas-luz': 'Con la pantalla blanca vemos el tamaño de tus pupilas con luz.',
    'pupilas-rojo': 'Ahora la pantalla se pone roja, que es como una luz tenue. Así vemos cómo se abren tus pupilas.',
    'pupilas-destello': 'Atento: viene un destello de luz blanca. No cierres los ojos, sigue mirando el punto.',
    'pupilas-listo': 'Listo. Con ese destello vimos cómo reacciona tu pupila a la luz.',
    'fin': 'Terminamos la prueba de ojos. Ahora te conecto con el asistente virtual.',
    'camara': 'Necesito que permitas la cámara. Toca el candado junto a la dirección de la página, '
              'permite la cámara y vuelve a intentarlo.',
}

MUSICA = {
    'prompt': 'Soft, calm ambient instrumental for a relaxation moment: warm piano and gentle pads, '
              'slow tempo around 60 bpm, no drums, no vocals, no sudden changes, steady and soothing.',
    'ms': 75000,   # el minuto de fatiga mas el margen; si se acaba, el navegador la repite
}


def voz(id_, texto):
    r = requests.post(
        f'https://api.elevenlabs.io/v1/text-to-speech/{VOZ}',
        params={'output_format': 'mp3_44100_64'},
        headers={'xi-api-key': KEY},
        json={'text': texto, 'model_id': MODELO, 'language_code': 'es',
              'voice_settings': {'stability': 0.55, 'similarity_boost': 0.8, 'speed': 0.95}},
        timeout=60,
    )
    r.raise_for_status()
    (SALIDA / f'{id_}.mp3').write_bytes(r.content)


def musica():
    r = requests.post(
        'https://api.elevenlabs.io/v1/music',
        params={'output_format': 'mp3_44100_128'},
        headers={'xi-api-key': KEY},
        json={'prompt': MUSICA['prompt'], 'music_length_ms': MUSICA['ms'], 'force_instrumental': True},
        timeout=300,
    )
    r.raise_for_status()
    crudo = SALIDA / 'musica-crudo.mp3'
    crudo.write_bytes(r.content)
    # Bajita y con entrada/salida suaves. El volumen va horneado en el archivo porque en iPhone
    # el navegador no deja cambiar el volumen de un <audio> desde JavaScript.
    dur = MUSICA['ms'] / 1000
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(crudo), '-af',
                    f'loudnorm=I=-30:TP=-6,afade=t=in:d=2,afade=t=out:st={dur - 3}:d=3',
                    '-b:a', '96k', str(SALIDA / 'musica.mp3')], check=True)
    crudo.unlink()


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    args = [a for a in sys.argv[1:] if a != '--todo']
    todo = '--todo' in sys.argv
    pedidos = args or [*TEXTOS, 'musica']
    for id_ in pedidos:
        archivo = SALIDA / f'{id_}.mp3'
        if archivo.exists() and not todo and not args:
            continue
        print('generando', id_)
        if id_ == 'musica':
            musica()
        elif id_ in TEXTOS:
            voz(id_, TEXTOS[id_])
        else:
            sys.exit(f'No conozco "{id_}"')


if __name__ == '__main__':
    main()
