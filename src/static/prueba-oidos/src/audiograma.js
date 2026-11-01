// Audiograma clasico en SVG: frecuencia en escala log, dB HL hacia abajo, O roja = derecho y X azul
// = izquierdo. Devuelve un string armado solo con numeros nuestros (sin texto del paciente), asi que
// se puede poner con innerHTML. Los colores salen de clases: cada pagina los define en su CSS.
import { FRECUENCIAS } from './resultado.js';

const EJE_F = [250, 500, 1000, 2000, 4000, 8000];

export function audiograma(umbrales, techo) {
    const W = 340, H = 250, izq = 34, der = 10, arr = 12, aba = 22;
    const x = (f) => izq + (Math.log2(f / 250) / Math.log2(8000 / 250)) * (W - izq - der);
    const y = (db) => arr + ((db + 10) / 90) * (H - arr - aba);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Audiograma">`;
    s += `<rect x="${izq}" y="${y(-10)}" width="${W - izq - der}" height="${y(20) - y(-10)}" class="ag-normal" rx="4"/>`;
    for (let db = -10; db <= 80; db += 10) {
        s += `<line x1="${izq}" x2="${W - der}" y1="${y(db)}" y2="${y(db)}" class="ag-rejilla"/>`;
        s += `<text x="${izq - 6}" y="${y(db) + 3.5}" class="ag-eje" text-anchor="end">${db}</text>`;
    }
    for (const f of EJE_F) {
        s += `<line x1="${x(f)}" x2="${x(f)}" y1="${y(-10)}" y2="${y(80)}" class="ag-rejilla"/>`;
        s += `<text x="${x(f)}" y="${H - 5}" class="ag-eje" text-anchor="middle">${f >= 1000 ? `${f / 1000}k` : f}</text>`;
    }
    for (const oido of ['od', 'oi']) {
        const puntos = FRECUENCIAS.map((f) => [f, umbrales?.[oido]?.[f]]).filter(([, u]) => u && (u.hl != null || u.estado === 'sin-respuesta'));
        const valor = (u) => (u.estado === 'sin-respuesta' ? techo : u.hl);
        s += `<polyline class="ag-linea ${oido}" points="${puntos.map(([f, u]) => `${x(f)},${y(valor(u))}`).join(' ')}"/>`;
        for (const [f, u] of puntos) {
            const cx = x(f), cy = y(valor(u));
            s += oido === 'od'
                ? `<circle cx="${cx}" cy="${cy}" r="5" class="ag-marca od"/>`
                : `<path d="M${cx - 5} ${cy - 5}L${cx + 5} ${cy + 5}M${cx + 5} ${cy - 5}L${cx - 5} ${cy + 5}" class="ag-marca oi"/>`;
            if (u.estado === 'sin-respuesta') s += `<path d="M${cx} ${cy + 7}v9m-4 -4l4 4l4 -4" class="ag-marca ${oido}"/>`;
        }
    }
    return `${s}</svg>`;
}
