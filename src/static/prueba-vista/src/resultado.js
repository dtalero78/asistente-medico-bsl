// Resultado de la prueba visual: agudeza por ojo, reloj de astigmatismo por ojo y colores → el
// concepto con las mismas tres etiquetas de la visiometría anterior (Normal / Aceptable / Revisión
// Sugerida), que leen el certificado y el informe por empresa. Sin DOM.
//
// Puntos de corte de TAMIZAJE (no validados aún en esta población; ajustar aquí, con nombre):
export const AGUDEZA_NORMAL = 0.3;        // logMAR ≤ 0.3 = 20/40 o mejor en cada ojo
export const AGUDEZA_ACEPTABLE = 0.5;     // el peor ojo hasta 20/63
export const DIFERENCIA_ENTRE_OJOS = 0.2; // 2 líneas o más entre un ojo y otro
export const DESTAPES_MAX = 3;            // vista.js deja de revisar el ojo tapado tras 3 destapes

import { SNELLEN } from '../../escaner-ocular/src/calibracion.js';

const ORDEN = ['Normal', 'Aceptable', 'Revisión Sugerida'];
const peor = (a, b) => ORDEN[Math.max(ORDEN.indexOf(a), ORDEN.indexOf(b))];

/**
 * @param ojos   { OD: { logMAR, snellen, peorQue?, reloj: 'igual'|'distinto'|null }, OI: {...} }
 * @param colores  resultado de colores.evaluarColores
 * @returns { concepto, motivos: [texto], decimal: { OD, OI } }
 */
export function concepto(ojos, colores) {
    let c = 'Normal';
    const motivos = [];
    const lm = (o) => (o && o.logMAR != null ? o.logMAR : null);
    const od = lm(ojos.OD), oi = lm(ojos.OI);

    for (const [nombre, o] of [['derecho', ojos.OD], ['izquierdo', ojos.OI]]) {
        const v = lm(o);
        if (v == null) {
            c = peor(c, 'Revisión Sugerida');
            motivos.push(o && o.peorQue ? `Ojo ${nombre}: no leyó ni ${o.peorQue}.` : `Ojo ${nombre}: no se pudo medir.`);
        } else if (o.limiteDePantalla && v > AGUDEZA_NORMAL) {
            // Leyó lo más fino que la pantalla dibuja y eso queda por encima del corte (pantalla de
            // muy baja densidad): no se le cobra al paciente; el médico ve hasta dónde se pudo medir
            motivos.push(`Ojo ${nombre}: leyó hasta ${SNELLEN(v)}, lo más fino que permite la pantalla; no se pudo medir el corte de 20/40.`);
        } else if (v > AGUDEZA_ACEPTABLE) {
            c = peor(c, 'Revisión Sugerida');
            motivos.push(`Ojo ${nombre}: agudeza ${SNELLEN(v)}.`);
        } else if (v > AGUDEZA_NORMAL) {
            c = peor(c, 'Aceptable');
            motivos.push(`Ojo ${nombre}: agudeza ${SNELLEN(v)}.`);
        }
        // Calidad de la medida: no cambia el concepto, pero el médico tiene que saberlo
        if (o && o.distanciaControlada === false) motivos.push(`Ojo ${nombre}: la cámara no pudo controlar la distancia.`);
        if (o && o.oclusionVerificada === false) motivos.push(`Ojo ${nombre}: no se pudo confirmar que el otro ojo estuviera tapado.`);
        else if (o && o.destapes >= DESTAPES_MAX) motivos.push(`Ojo ${nombre}: el otro ojo se destapó varias veces durante la prueba.`);
        if (o && o.reloj === 'distinto') {
            c = peor(c, 'Aceptable');
            motivos.push(`Ojo ${nombre}: algunas líneas del reloj se ven más oscuras (posible astigmatismo).`);
        }
    }
    if (od != null && oi != null && Math.abs(od - oi) >= DIFERENCIA_ENTRE_OJOS - 1e-9) {
        c = peor(c, 'Aceptable');
        motivos.push('Diferencia de 2 líneas o más entre un ojo y otro.');
    }
    if (colores) {
        if (colores.lectura === 'alterada') {
            c = peor(c, 'Revisión Sugerida');
            motivos.push('Visión de colores alterada (rojo-verde).');
        } else if (colores.lectura === 'dudosa') {
            c = peor(c, 'Aceptable');
            motivos.push('Visión de colores dudosa.');
        } else if (colores.lectura === 'no-valida') {
            c = peor(c, 'Aceptable');
            motivos.push('La prueba de colores no fue válida (no leyó la lámina de ejemplo).');
        }
    }
    const decimal = (v) => (v == null ? null : Math.round(100 * Math.pow(10, -v)));
    return { concepto: c, motivos, decimal: { OD: decimal(od), OI: decimal(oi) } };
}
