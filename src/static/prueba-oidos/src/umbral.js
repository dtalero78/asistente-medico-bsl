// Busqueda del umbral de UNA frecuencia en UN oido: Hughson-Westlake modificado (ASHA 2005,
// ISO 8253-1). Baja 10 dB cuando el paciente oye, sube 5 dB cuando no. El umbral es el nivel mas
// bajo oido en 2 subidas ("ascendente" = el ensayo anterior fue un "no oi").
//
// Sin DOM ni audio: recibe "oyo / no oyo" y dice el siguiente nivel. Trabaja en dB HL estimados;
// pasar a dBFS es cosa de quien presenta el tono (perfiles.js). Los ensayos sin tono (control de
// falsos positivos) los maneja la cascara: aqui no entran.

export const PASO_BAJA = 10;
export const PASO_SUBE = 5;
export const PASO_BUSCA = 10;     // antes de la primera respuesta se sube de a 10 para no gastar ensayos
export const ACIERTOS_UMBRAL = 2;
export const MAX_ENSAYOS = 24;

/**
 * @param {{inicio:number, piso:number, techo:number, maxEnsayos?:number}} op
 * Estados del resultado:
 *   ok            umbral encontrado
 *   piso          oye en el nivel mas bajo que se presenta: umbral <= piso
 *   sin-respuesta no oye ni en el techo: umbral > techo
 *   no-convergio  se acabaron los ensayos; `umbral` es la mejor estimacion (puede ser null)
 */
export function crearUmbral({ inicio, piso, techo, maxEnsayos = MAX_ENSAYOS }) {
    let nivel = limitar(inicio);
    let primerAcierto = false;
    let anteriorFallo = false;
    let fallosTecho = 0;
    let terminado = null;            // {umbral, estado}
    const ascendentes = new Map();   // nivel -> {n, aciertos}
    const historial = [];            // [{nivel, oyo, ascendente}]

    function limitar(n) {
        return Math.min(techo, Math.max(piso, n));
    }

    function siguiente() {
        return terminado ? null : nivel;
    }

    function responder(oyo) {
        if (terminado) return;
        // En el piso no se puede bajar mas: cada presentacion ahi cuenta como subida
        const ascendente = primerAcierto && (anteriorFallo || nivel === piso);
        historial.push({ nivel, oyo, ascendente });

        if (ascendente) {
            const c = ascendentes.get(nivel) || { n: 0, aciertos: 0 };
            c.n++;
            if (oyo) c.aciertos++;
            ascendentes.set(nivel, c);
            if (c.aciertos >= ACIERTOS_UMBRAL) {
                terminado = { umbral: nivel, estado: nivel === piso ? 'piso' : 'ok' };
                return;
            }
        }

        if (!oyo && nivel === techo) {
            fallosTecho++;
            if (fallosTecho >= 2) {
                terminado = { umbral: null, estado: 'sin-respuesta' };
                return;
            }
        }

        if (oyo) {
            primerAcierto = true;
            nivel = limitar(nivel - PASO_BAJA);
        } else {
            nivel = limitar(nivel + (primerAcierto ? PASO_SUBE : PASO_BUSCA));
        }
        anteriorFallo = !oyo;

        if (historial.length >= maxEnsayos) {
            terminado = { umbral: mejorEstimacion(), estado: 'no-convergio' };
        }
    }

    // El nivel mas bajo con al menos un acierto en subida; si no hay, null
    function mejorEstimacion() {
        const conAcierto = [...ascendentes].filter(([, c]) => c.aciertos > 0).map(([n]) => n);
        return conAcierto.length ? Math.min(...conAcierto) : null;
    }

    function resultado() {
        return { ...(terminado || { umbral: null, estado: 'en-curso' }), ensayos: historial.length, historial };
    }

    return { siguiente, responder, resultado, get terminado() { return !!terminado; } };
}
