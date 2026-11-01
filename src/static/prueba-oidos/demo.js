// Pagina de prueba: corre examenOidos (static/js/oidos.js) igual que el avatar y muestra el
// resultado y el JSON. Lo deja tambien en window.__pruebaOidos (lo lee pruebas/simulador.js).
import { prepararAudio, examenOidos, pintarResultadosOidos } from '../js/oidos.js';
import { crearGuia } from '../js/guia-voz.js';

const $ = (id) => document.getElementById(id);
const vc = $('vc');
const guia = crearGuia();
guia.precargar();

$('empezar').addEventListener('click', async () => {
    // Sincrono dentro del toque: en iPhone el audio solo se desbloquea aqui
    guia.desbloquear();
    const salida = prepararAudio();
    try {
        // Microfono y camara en un solo aviso, como el avatar en "Iniciar Consulta"
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
        s.getTracks().forEach((t) => t.stop());
    } catch (e) {
        console.warn('[demo] Sin permisos:', e.name);
    }
    vc.dataset.estado = 'oidos';
    const resultado = await examenOidos({
        paso: $('oidosPaso'), barra: $('oidosBarra'), orbe: $('oidosOrbe'), orbeTexto: $('oidosOrbeTexto'),
        titulo: $('oidosTitulo'), indicacion: $('oidosIndicacion'), voz: $('oidosVoz'),
        opciones: $('oidosOpciones'), lados: $('oidosLados'), frecuencias: $('oidosFrecuencias'),
        camara: $('oidosCamara'), guia,
    }, salida);
    window.__pruebaOidos = resultado;
    vc.dataset.estado = 'fin';
    pintarResultadosOidos($('oidosResultados'), resultado);
    $('json').textContent = JSON.stringify(resultado, null, 2);
    $('resumenCard').hidden = false;
});
$('repetir').addEventListener('click', () => location.reload());
