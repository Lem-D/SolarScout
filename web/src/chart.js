/**
 * Monthly production chart for the roof panel.
 *
 * One series, so no legend box: the section heading says what is plotted. Bars are
 * capped at 24px with a 4px rounded top squared to the baseline, gridlines are hairline
 * and recessive, and every value is reachable on hover — the axis labels only the
 * quarters so twelve month names cannot collide.
 */

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
} from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Read the UI tokens so the chart cannot drift from the panel it sits in.
function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

let chart = null;

export function renderMonthly(canvas, monthlyKwh) {
  const surface = token('--surface-1', '#1a1a19');
  const series = token('--series-1', '#3987e5');
  const ink2 = token('--text-secondary', '#c3c2b7');
  const grid = token('--hairline', '#383835');

  const data = {
    labels: MONTHS,
    datasets: [{
      data: monthlyKwh,
      backgroundColor: series,
      // A 2px ring in the surface colour is the gap between touching bars.
      borderColor: surface,
      borderWidth: { top: 0, left: 1, right: 1, bottom: 0 },
      borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
      borderSkipped: 'bottom',
      maxBarThickness: 24,
      categoryPercentage: 0.9,
      barPercentage: 0.86,
    }],
  };

  if (chart) {
    chart.data = data;
    chart.update('none');
    return chart;
  }

  chart = new Chart(canvas, {
    type: 'bar',
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      layout: { padding: { top: 4 } },
      scales: {
        x: {
          grid: { display: false },
          border: { color: grid },
          ticks: {
            color: ink2,
            font: { size: 10 },
            autoSkip: false,
            // Quarters only: twelve labels in 320px would collide.
            callback: (v, i) => (i % 3 === 0 ? MONTHS[i] : ''),
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: grid, lineWidth: 1, drawTicks: false },
          border: { display: false },
          ticks: { color: ink2, font: { size: 10 }, maxTicksLimit: 4, padding: 6 },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: token('--surface-2-solid', '#262624'),
          borderColor: grid,
          borderWidth: 1,
          titleColor: token('--text-primary', '#fff'),
          bodyColor: ink2,
          displayColors: false,
          padding: 8,
          callbacks: {
            title: (items) => MONTHS[items[0].dataIndex],
            label: (item) => `${Math.round(item.parsed.y)} kWh`,
          },
        },
      },
    },
  });
  return chart;
}

export function destroyChart() {
  chart?.destroy();
  chart = null;
}
