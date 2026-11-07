"""Genera con ElevenLabs la voz que guia las pruebas de oidos y de ojos, y la musica del minuto quieto.

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

# De tu, como el medico. Frases cortas: en la de ojos el paciente esta mirando la camara, no la pantalla.
TEXTOS = {
    # Prueba de oidos (static/js/oidos.js): va primero. Aqui el paciente si mira la pantalla y
    # contesta con botones; la voz dice que tocar. Nunca habla mientras suenan los tonos.
    'oidos-intro': 'Hola. Antes de hablar con el asistente virtual vamos a hacer dos pruebas cortas: '
                   'primero tus oídos y después tus ojos. Yo te voy guiando. Mientras suenan los tonos '
                   'voy a tomar unas fotos con la cámara, para confirmar que eres tú quien hace la prueba.',
    'oidos-audifonos': 'Ponte tus audífonos, los dos, y toca en la pantalla qué tipo de audífonos tienes.',
    'oidos-sin-audifonos': 'Sin audífonos no podemos hacer la prueba de oídos. Sigamos con la de los ojos.',
    # Sin prueba de ojos despues (ya la hizo en la visiometria de la plataforma): las frases que
    # nombran los ojos tienen su version que dice que sigue el asistente (oidos.js, p.sinOjos)
    'oidos-intro-solo': 'Hola. Antes de hablar con el asistente virtual vamos a hacer una prueba corta de '
                        'tus oídos. Yo te voy guiando. Mientras suenan los tonos voy a tomar unas fotos con la '
                        'cámara, para confirmar que eres tú quien hace la prueba.',
    'oidos-sin-audifonos-solo': 'Sin audífonos no podemos hacer la prueba de oídos. Sigamos con el asistente virtual.',
    'oidos-no-suena-solo': 'No logramos que suene. Puedes probar otra vez, o seguir con el asistente virtual.',
    'conectando': 'Ahora te conecto con el asistente virtual.',
    'oidos-silencio': 'Quédate en silencio unos segundos, que voy a medir el ruido del lugar.',
    'oidos-ruido': 'Hay mucho ruido donde estás. Si puedes, busca un lugar más silencioso y toca: medir otra vez.',
    'oidos-volumen': 'Sube el volumen de tu celular hasta el máximo. Cuando lo tengas, toca: ya lo subí.',
    'oidos-tono': 'Ahora vas a oír un tono en los dos oídos.',
    'oidos-oiste': '¿Lo oíste? Toca tu respuesta.',
    'oidos-no-sono': 'No sonó. Revisa que el volumen esté al máximo y que los audífonos estén conectados. '
                     'Si tienes iPhone, revisa que no esté en modo silencio.',
    # Tras 2 "No oí nada" en la revision de volumen: salida para no quedar atascado
    'oidos-no-suena': 'No logramos que suene. Puedes probar otra vez, o seguir con la prueba de los ojos.',
    # iPhone con iOS anterior a 16.4: el interruptor de silencio calla los tonos
    'oidos-iphone-silencio': 'Antes de seguir, apaga el modo silencio de tu iPhone: es el interruptor del costado, '
                             'encima de los botones de volumen. Cuando lo apagues, toca: listo.',
    'oidos-parlante': 'Parece que el sonido está saliendo por el parlante del celular. Conecta tus audífonos y póntelos.',
    'oidos-lado': 'Ahora vas a oír un tono en un solo oído. Después me dices en cuál lo oíste.',
    'oidos-cual': '¿En qué oído lo oíste?',
    'oidos-al-reves': 'Parece que tienes los audífonos al revés. El que dice R va en el oído derecho, '
                      'y el que dice L, en el izquierdo. Probemos otra vez.',
    'oidos-otra-vez': 'Revisa que tengas puestos los dos audífonos y probemos otra vez.',
    'oidos-prueba': 'Muy bien. Ahora empieza la prueba. Vas a oír pitidos cortos, unos fuertes y otros muy suaves. '
                    'Apenas oigas uno, toca el botón azul enseguida, sin esperar a que termine. '
                    'Si no oyes nada, no toques: hay momentos sin pitido a propósito. '
                    'Mientras suenan, yo me quedo callado. Primero practicamos con unos fuertes.',
    # Practica (ver practicar() en oidos.js)
    'oidos-practica-lista': '¡Eso es! Así de rápido. Ahora sí, empezamos con el oído derecho.',
    'oidos-practica-otra': 'No alcanzaste a tocar. Apenas suene el pitido, toca el botón azul, '
                           'no esperes a que termine. Probemos otra vez.',
    'oidos-practica-sigamos': 'Sigamos. Empezamos con el oído derecho.',
    'oidos-izquierdo': 'Vas muy bien. Ahora el oído izquierdo. Recuerda: toca apenas oigas el pitido, y solo si lo oyes.',
    # Antes de cada frecuencia, alternados para que no suene repetido
    'oidos-solo': 'Toca apenas oigas el pitido, y solo si lo oyes.',
    'oidos-solo-2': 'Otro tono. Toca enseguida, pero solo si lo oyes.',
    # Toco en un momento sin pitido: se le corrige y se repite esa frecuencia
    'oidos-sin-tono': 'Tocaste cuando no había ningún pitido. Toca solo cuando lo oigas de verdad. Repetimos este tono.',
    # Dejo de responder tonos fuertes (ver INACTIVO_FALLOS en oidos.js)
    'oidos-sigues': '¿Sigues ahí? Toca el botón para continuar.',
    'oidos-pausa': 'Se pausó el sonido. Revisa tus audífonos y toca: continuar.',
    'oidos-fin': 'Listo, terminamos con tus oídos.',

    # Prueba de ojos (static/js/ojos.js): va despues de la de oidos
    'intro': 'Ahora vamos a revisar tus ojos con la cámara. Son unos dos minutos y yo te voy guiando.',
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
    # Visiometria virtual de BSL-PLATAFORMA2: la prueba de ojos va al final y despues sigue su circuito
    'fin-visio': 'Terminamos la prueba de ojos. Muchas gracias.',
    # Prueba visual (static/js/vista.js): agudeza de cerca por ojo, reloj de astigmatismo y colores.
    # Aquí el paciente sí mira la pantalla y contesta con botones.
    'vista-intro': 'Vamos a revisar qué tan bien ves de cerca, un ojo a la vez, y los colores. Yo te voy guiando paso a paso.',
    'vista-gafas': '¿Usas gafas o lentes de contacto? Toca sí o no.',
    'vista-ponte-gafas': 'Si las tienes contigo, póntelas ahora: la prueba se hace con ellas. Cuando estés listo, toca Listo.',
    'vista-miopia': '¿Algún médico te ha dicho que tienes miopía?',
    'vista-astigmatismo': '¿Y astigmatismo?',
    'vista-tarjeta': 'Necesito saber el tamaño de tu pantalla. Pon una tarjeta, como tu cédula, sobre la pantalla, '
                     'y mueve la barra hasta que el rectángulo tenga el mismo ancho. Luego toca Listo.',
    'vista-distancia': 'Ahora sostén el celular frente a tu cara, a unos cuarenta centímetros, más o menos el largo de '
                       'tu antebrazo. Yo te digo si te acercas o te alejas.',
    'vista-distancia-pc': 'Ahora siéntate frente a la cámara, más o menos a medio metro, con la cara de frente. '
                          'Yo te digo si te acercas o te alejas.',
    'vista-distancia-bien': 'Así está bien. Trata de mantener esa distancia durante toda la prueba.',
    'vista-tapa-izquierdo': 'Tápate el ojo izquierdo con la palma de la mano, sin apretarlo, y deja el derecho abierto. '
                            'Vamos a revisar tu ojo derecho.',
    'vista-tapa-derecho': 'Ahora destapa el izquierdo y tápate el ojo derecho. Vamos con tu ojo izquierdo.',
    'vista-tapa-bien-izquierdo': 'Mantén bien tapado el ojo izquierdo.',
    'vista-tapa-bien-derecho': 'Mantén bien tapado el ojo derecho.',
    'vista-otro-ojo-izquierdo': 'Ese es el otro. Tápate el ojo izquierdo y deja el derecho abierto.',
    'vista-otro-ojo-derecho': 'Ese es el otro. Tápate el ojo derecho y deja el izquierdo abierto.',
    'vista-e': 'Vas a ver una letra E. Toca la flecha hacia donde apuntan sus patas. Si no la ves, toca No la veo. '
               'Cada vez va a ser más pequeña: está bien no verlas todas.',
    'vista-reloj': 'Ahora mira el centro de este reloj de líneas. ¿Todas las líneas se ven igual de negras, o algunas '
                   'se ven más oscuras que otras?',
    'vista-destapate': 'Muy bien. Ya puedes destaparte los ojos.',
    'vista-colores': 'Por último, los colores. En cada círculo de puntos hay un número escondido. Toca el número que '
                     'veas, o No veo ningún número.',
    'vista-fin': 'Terminamos la prueba visual.',
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
