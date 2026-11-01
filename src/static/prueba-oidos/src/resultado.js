// Umbrales -> lo que se informa: PTA4, grado OMS, asimetria, caida en agudos y confiabilidad.
// Sin DOM: se prueba en pruebas/unidad.html.
//
// El dB HL es ESTIMADO (perfiles.js). Lo que mas pesa en el veredicto es lo que no depende de la
// calibracion: la diferencia entre oidos y la forma de la curva en el mismo oido (mismo audifono,
// mismo volumen), la repeticion de 1 kHz y los falsos positivos.

export const FRECUENCIAS = [500, 1000, 2000, 3000, 4000, 6000];
export const PTA4_FRECUENCIAS = [500, 1000, 2000, 4000];

// Para promediar: "oye en el piso" vale el piso y "no oye en el techo" vale techo + 5
export function valorPromediable(u, techo) {
    if (!u) return null;
    if (u.estado === 'sin-respuesta') return techo + 5;
    return u.hl ?? null;
}

function promedio(valores) {
    if (!valores.length || valores.some((v) => v == null)) return null;
    return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/** @param oido {[frecuencia]: {hl, estado}} */
export function pta4(oido, techo) {
    const p = promedio(PTA4_FRECUENCIAS.map((f) => valorPromediable(oido[f], techo)));
    return p == null ? null : Math.round(p * 10) / 10;
}

// OMS, Informe mundial sobre la audicion (2021)
const GRADOS = [
    [20, 'normal'], [35, 'leve'], [50, 'moderada'], [65, 'moderadamente grave'],
    [80, 'grave'], [95, 'profunda'], [Infinity, 'completa'],
];

export function gradoOMS(pta) {
    if (pta == null) return null;
    return GRADOS.find(([limite]) => pta < limite)[1];
}

// 15 dB o mas de diferencia en dos frecuencias seguidas
export const ASIMETRIA_DB = 15;

export function asimetria(od, oi, techo) {
    const difs = FRECUENCIAS.map((f) => {
        const a = valorPromediable(od[f], techo);
        const b = valorPromediable(oi[f], techo);
        return a == null || b == null ? null : a - b;
    });
    let peor = null;
    for (let i = 0; i < difs.length - 1; i++) {
        const x = difs[i], y = difs[i + 1];
        if (x == null || y == null) continue;
        if (Math.abs(x) >= ASIMETRIA_DB && Math.abs(y) >= ASIMETRIA_DB && Math.sign(x) === Math.sign(y)) {
            peor = x > 0 ? 'od' : 'oi';
            break;
        }
    }
    return { presente: !!peor, peorOido: peor, diferencias: Object.fromEntries(FRECUENCIAS.map((f, i) => [f, difs[i]])) };
}

// Agudos (3-6 kHz) 15 dB peores que graves (0,5-2 kHz) y por encima de 25 dB HL: el patron que
// deja el ruido. No es el criterio de Coles completo (pide 8 kHz, que aqui no se mide).
export const CAIDA_DB = 15;
export const CAIDA_MIN_HL = 25;

export function caidaAgudos(oido, techo) {
    const graves = promedio([500, 1000, 2000].map((f) => valorPromediable(oido[f], techo)));
    const agudos = promedio([3000, 4000, 6000].map((f) => valorPromediable(oido[f], techo)));
    if (graves == null || agudos == null) return { presente: false, diferencia: null };
    const diferencia = Math.round((agudos - graves) * 10) / 10;
    return { presente: diferencia >= CAIDA_DB && agudos > CAIDA_MIN_HL, diferencia };
}

// Umbrales de confiabilidad. Provisionales hasta la validacion contra las presenciales de Bogota.
export const LIMITES = {
    falsosDudosa: 0.10, falsosNoConfiable: 0.20,       // fraccion de ensayos sin tono contestados
    // Toques fuera de ventana por ensayo. Un paciente honesto casi no tiene (0-3 en ~150 ensayos)
    espontaneosDudosa: 0.08, espontaneosNoConfiable: 0.15,
    retestDudosa: 10, retestNoConfiable: 15,            // dB de diferencia al repetir 1 kHz
    ruidoDudosa: -60, ruidoNoConfiable: -50,            // dBFS del microfono (sin calibrar)
    planaRango: 10, planaMinPta: 30,                    // curva plana y alta en los dos oidos
    correccionesDudosa: 2, correccionesNoConfiable: 3,  // veces que se le dijo "toca solo cuando lo oigas"
    pausasDudosa: 2,                                    // veces que dejo de responder ("¿Sigues ahí?")
};

/**
 * @param d {{od, oi, ptaOd, ptaOi, falsos:{control, contestados, espontaneos, ensayos},
 *            retest:{primero, segundo}|null, ruido:{antes, despues}|null, lateralidad:'ok'|'fallo'|null,
 *            parlante:boolean|null, perfil:{bluetooth}, techo, correcciones?, pausas?}}
 */
export function confiabilidad(d) {
    const motivos = [];
    let nivel = 0;   // 0 confiable, 1 dudosa, 2 no confiable
    let conducta = false;   // toco sin pitido: un resultado normal no se le puede creer
    const marcar = (n, texto) => { nivel = Math.max(nivel, n); motivos.push(texto); };
    const tocoSinPitido = (n, texto) => { conducta = true; marcar(n, texto); };

    const { control, contestados, espontaneos, ensayos } = d.falsos;
    const tasa = control ? contestados / control : 0;
    if (tasa >= LIMITES.falsosNoConfiable) tocoSinPitido(2, `Contestó ${contestados} de ${control} silencios`);
    else if (tasa >= LIMITES.falsosDudosa) tocoSinPitido(1, `Contestó ${contestados} de ${control} silencios`);
    const sueltos = ensayos ? espontaneos / ensayos : 0;
    if (sueltos >= LIMITES.espontaneosNoConfiable) tocoSinPitido(2, `${espontaneos} toques sin tono`);
    else if (sueltos >= LIMITES.espontaneosDudosa) tocoSinPitido(1, `${espontaneos} toques sin tono`);

    if (d.retest && d.retest.primero != null && d.retest.segundo != null) {
        const dif = Math.abs(d.retest.primero - d.retest.segundo);
        if (dif > LIMITES.retestNoConfiable) marcar(2, `1 kHz repetido cambió ${dif} dB`);
        else if (dif > LIMITES.retestDudosa) marcar(1, `1 kHz repetido cambió ${dif} dB`);
    }

    const ruido = d.ruido ? Math.max(d.ruido.antes ?? -Infinity, d.ruido.despues ?? -Infinity) : null;
    if (ruido != null && Number.isFinite(ruido)) {
        if (ruido >= LIMITES.ruidoNoConfiable) marcar(2, 'Lugar muy ruidoso');
        else if (ruido >= LIMITES.ruidoDudosa) marcar(1, 'Lugar con ruido');
    } else {
        marcar(1, 'No se pudo medir el ruido');
    }

    if ((d.correcciones || 0) >= LIMITES.correccionesNoConfiable) tocoSinPitido(2, `Hubo que corregirlo ${d.correcciones} veces por tocar sin pitido`);
    else if ((d.correcciones || 0) >= LIMITES.correccionesDudosa) tocoSinPitido(1, `Hubo que corregirlo ${d.correcciones} veces por tocar sin pitido`);
    if ((d.pausas || 0) >= LIMITES.pausasDudosa) marcar(1, `Dejó de responder ${d.pausas} veces`);
    if (d.lateralidad === 'fallo') marcar(2, 'No distinguió el oído izquierdo del derecho');
    if (d.parlante) marcar(2, 'El sonido parecía salir por el parlante, no por audífonos');

    const noConvergio = ['od', 'oi'].flatMap((o) => Object.entries(d[o])
        .filter(([, u]) => u.estado === 'no-convergio').map(([f]) => `${o.toUpperCase()} ${f}`));
    if (noConvergio.length) marcar(1, `Respuestas inconsistentes en ${noConvergio.join(', ')}`);

    // Todo igual de alto en los dos oidos suele ser volumen bajo, no sordera
    const todos = ['od', 'oi'].flatMap((o) => FRECUENCIAS.map((f) => valorPromediable(d[o][f], d.techo)));
    if (todos.every((v) => v != null) && d.ptaOd >= LIMITES.planaMinPta && d.ptaOi >= LIMITES.planaMinPta
        && Math.max(...todos) - Math.min(...todos) <= LIMITES.planaRango) {
        marcar(1, 'Curva plana en ambos oídos: posible volumen bajo');
    }

    if (d.perfil.bluetooth) motivos.push('Audífonos Bluetooth: los tonos muy suaves pueden perderse');

    return { nivel: ['confiable', 'dudosa', 'no-confiable'][nivel], motivos, conducta };
}

/** Todo lo que se informa, a partir de los umbrales de los dos oidos. */
export function resumir(d) {
    const ptaOd = pta4(d.od, d.techo);
    const ptaOi = pta4(d.oi, d.techo);
    const mejor = ptaOd == null ? ptaOi : ptaOi == null ? ptaOd : Math.min(ptaOd, ptaOi);
    const asim = asimetria(d.od, d.oi, d.techo);
    const caidaOd = caidaAgudos(d.od, d.techo);
    const caidaOi = caidaAgudos(d.oi, d.techo);
    const conf = confiabilidad({ ...d, ptaOd, ptaOi });
    const alterado = (ptaOd ?? 0) >= 20 || (ptaOi ?? 0) >= 20 || asim.presente || caidaOd.presente || caidaOi.presente;
    return {
        pta4: { od: ptaOd, oi: ptaOi },
        grado: { od: gradoOMS(ptaOd), oi: gradoOMS(ptaOi), general: gradoOMS(mejor) },
        asimetria: asim,
        caidaAgudos: { od: caidaOd, oi: caidaOi },
        confiabilidad: conf,
        // Tamizaje: "remitir" si sale alterado. Si toco sin pitido, un resultado normal es justo lo
        // que produce la trampa (sus umbrales salen mejores de lo que son): nunca "pasa", "repetir".
        veredicto: conf.nivel === 'no-confiable' ? 'repetir'
            : alterado ? 'remitir'
                : conf.conducta ? 'repetir' : 'pasa',
    };
}
