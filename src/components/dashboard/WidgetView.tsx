'use client';

import React, { useMemo } from 'react';
import { Tooltip } from 'antd';
import {
  ArrowRightOutlined,
  BarChartOutlined,
  CaretDownOutlined,
  CaretUpOutlined,
  InfoCircleOutlined,
  PieChartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { AgCharts } from 'ag-charts-react';
import { AllCommunityModule, ModuleRegistry, type AgChartOptions } from 'ag-charts-community';
import dayjs from 'dayjs';
import type { DashboardWidgetData, WidgetType, WidgetValueFormat } from '@/types';
import styles from './Dashboard.module.css';

// AG Charts 13: the chart types come as modules, registered once
ModuleRegistry.registerModules([AllCommunityModule]);

/** Chart colours: bright, distinct, readable on white */
const PALETTE = ['#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#e53935', '#3949ab', '#d81b60', '#7cb342', '#6d4c41'];

/** A widget's colour pair (light -> dark): the KPI card's gradient, the card's top bar, table headers, a line's colour */
export interface WidgetAccent {
  from: string;
  to: string;
}

/** One accent per widget, in Dashboard order (the 9th starts again) */
export const ACCENTS: WidgetAccent[] = [
  { from: '#42a5f5', to: '#1565c0' }, // blue
  { from: '#26c6a6', to: '#00796b' }, // teal
  { from: '#ffa726', to: '#e65100' }, // orange
  { from: '#ab47bc', to: '#6a1b9a' }, // purple
  { from: '#5c6bc0', to: '#283593' }, // indigo
  { from: '#ef5350', to: '#b71c1c' }, // red
  { from: '#66bb6a', to: '#2e7d32' }, // green
  { from: '#ec407a', to: '#ad1457' }, // pink
];

const accentVars = (a: WidgetAccent) => ({ '--accent-from': a.from, '--accent-to': a.to }) as React.CSSProperties;

/** A value as the widget's Value Format shows it */
export function formatValue(value: unknown, format: WidgetValueFormat): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (format === 'AMOUNT') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (format === 'PERCENT') return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * A table cell: dates as DD.MM.YY; whole numbers as they are (document Nos., counts, days); other numbers as amounts
 * (thousands separators, 2 decimals); the rest as text
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = dayjs(s);
    return d.hour() === 0 && d.minute() === 0 ? d.format('DD.MM.YY') : d.format('DD.MM.YY HH:mm');
  }
  return s;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface WidgetBodyProps {
  widgetType: WidgetType;
  valueFormat: WidgetValueFormat;
  data: DashboardWidgetData;
  accent: WidgetAccent;
}

/** KPI: the 1st column of the 1st row; a 2nd column is the figure to compare with (shown as up / down %) */
function KpiBody({ data, valueFormat }: WidgetBodyProps) {
  const row = data.rowList[0]?.cells ?? [];
  const value = row[0];
  const hasCompare = data.columnList.length > 1;
  const compare = row[1];
  const change = hasCompare && num(compare) !== 0 ? ((num(value) - num(compare)) / Math.abs(num(compare))) * 100 : null;
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiValue}>{formatValue(value ?? 0, valueFormat)}</div>
      {hasCompare && (
        <div className={styles.kpiCompare}>
          {change !== null && (
            <span className={change >= 0 ? styles.up : styles.down}>
              {change >= 0 ? <CaretUpOutlined /> : <CaretDownOutlined />} {Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 1 })}%
            </span>
          )}
          <span>
            {data.columnList[1].name}: {formatValue(compare ?? 0, valueFormat)}
          </span>
        </div>
      )}
    </div>
  );
}

/** BAR / LINE: 1st column = label, every other column a series; PIE: label + value */
function ChartBody({ widgetType, valueFormat, data, accent }: WidgetBodyProps) {
  const options = useMemo<AgChartOptions>(() => {
    const series = data.columnList.slice(1).map((c, i) => ({ key: `s${i}`, name: c.name }));
    const rows = data.rowList.map((r, n) => ({
      __i: n,
      label: cellText(r.cells[0]),
      ...Object.fromEntries(series.map((s, i) => [s.key, num(r.cells[i + 1])])),
    }));
    // One series: every bar its own colour; several: a colour per series (the legend tells them apart)
    const oneSeries = series.length === 1;
    const lineColour = (i: number) => (i === 0 ? accent.to : PALETTE[i % PALETTE.length]);
    // Every value a whole number up to 10 (e.g. a count of visits)
    const values = rows.flatMap((r) => series.map((s) => Number((r as Record<string, unknown>)[s.key])));
    const wholeCounts = values.length > 0 && values.every((v) => Number.isInteger(v)) && Math.max(...values) <= 10;
    const fmt = (v: number) => formatValue(v, valueFormat);
    const base = {
      data: rows,
      background: { visible: false },
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      theme: { palette: { fills: PALETTE, strokes: PALETTE } },
    };
    // Tooltip: the label as heading, the value in the widget's format
    const tooltip = (key: string, name: string) => ({
      renderer: ({ datum }: { datum: Record<string, number | string> }) => ({
        heading: String(datum.label),
        data: [{ label: name, value: fmt(Number(datum[key])) }],
      }),
    });
    if (widgetType === 'PIE') {
      const key = series[0]?.key ?? 's0';
      return {
        ...base,
        series: [
          {
            type: 'donut',
            angleKey: key,
            legendItemKey: 'label',
            calloutLabelKey: 'label',
            sectorLabelKey: key,
            sectorLabel: { formatter: ({ value }: { value: number }) => fmt(value) },
            innerRadiusRatio: 0.6,
            tooltip: tooltip(key, series[0]?.name ?? ''),
          },
        ],
        legend: { position: 'right' },
      } as unknown as AgChartOptions;
    }
    return {
      ...base,
      series: series.map((s, i) => ({
        type: widgetType === 'LINE' ? 'line' : 'bar',
        xKey: 'label',
        yKey: s.key,
        yName: s.name,
        ...(widgetType === 'LINE'
          ? { stroke: lineColour(i), strokeWidth: 3, marker: { size: 8, fill: lineColour(i), stroke: '#ffffff', strokeWidth: 2 } }
          : {
              cornerRadius: 4,
              fill: PALETTE[i % PALETTE.length],
              ...(oneSeries
                ? {
                    itemStyler: ({ datum }: { datum: { __i: number } }) => {
                      const colour = PALETTE[datum.__i % PALETTE.length];
                      return { fill: colour, stroke: colour };
                    },
                  }
                : {}),
            }),
        tooltip: tooltip(s.key, s.name),
      })),
      // AG Charts 13: axes by key. Small whole numbers (counts): steps of 1, not 0.2.
      axes: {
        x: { type: 'category', position: 'bottom', paddingInner: 0.35 },
        y: {
          type: 'number',
          position: 'left',
          label: { formatter: ({ value }: { value: number }) => fmt(value) },
          ...(wholeCounts ? { interval: { step: 1 } } : {}),
        },
      },
      legend: { enabled: series.length > 1, position: 'bottom' },
    } as unknown as AgChartOptions;
  }, [widgetType, valueFormat, data, accent]);

  if (data.rowList.length === 0) return <div className={styles.empty}>No data</div>;
  return <AgCharts options={options} style={{ height: '100%', width: '100%' }} />;
}

/** TABLE: the rows as returned (at most 50) */
function TableBody({ data }: WidgetBodyProps) {
  if (data.rowList.length === 0) return <div className={styles.empty}>No data</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {data.columnList.map((c) => (
              <th key={c.name}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rowList.map((r, i) => (
            <tr key={i}>
              {r.cells.map((v, n) => (
                <td key={n} className={typeof v === 'number' ? styles.numberCell : undefined}>
                  {cellText(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface WidgetViewProps {
  title: string;
  widgetType: WidgetType;
  valueFormat: WidgetValueFormat;
  remarks?: string | null;
  /** null while loading */
  data: DashboardWidgetData | null;
  error?: string | null;
  /** Clicking the widget opens this (its Link) */
  onOpen?: () => void;
  /** Its colours (by its place on the Dashboard) */
  accent?: WidgetAccent;
}

/** The faint picture in a KPI card's corner, by what the figure is */
const KPI_ICONS: Record<WidgetValueFormat, React.ReactNode> = {
  AMOUNT: <WalletOutlined />,
  PERCENT: <PieChartOutlined />,
  NUMBER: <BarChartOutlined />,
};

/** One widget: a card with its title and the KPI (a coloured card) / chart / table, in its accent colours */
export function WidgetView({ title, widgetType, valueFormat, remarks, data, error, onOpen, accent = ACCENTS[0] }: WidgetViewProps) {
  const body = error ? (
    <div className={styles.error}>{error}</div>
  ) : !data ? (
    <div className={styles.empty}>Loading...</div>
  ) : widgetType === 'KPI' ? (
    <KpiBody widgetType={widgetType} valueFormat={valueFormat} data={data} accent={accent} />
  ) : widgetType === 'TABLE' ? (
    <TableBody widgetType={widgetType} valueFormat={valueFormat} data={data} accent={accent} />
  ) : (
    <ChartBody widgetType={widgetType} valueFormat={valueFormat} data={data} accent={accent} />
  );
  return (
    <div
      className={`${styles.widget} ${widgetType === 'KPI' ? styles.widgetKpi : widgetType === 'TABLE' ? styles.widgetTable : styles.widgetChart}`}
      style={accentVars(accent)}
    >
      {widgetType === 'KPI' && <span className={styles.kpiIcon}>{KPI_ICONS[valueFormat]}</span>}
      <div className={styles.widgetHeader}>
        <span className={styles.widgetTitle}>{title}</span>
        {remarks && (
          <Tooltip title={remarks}>
            <InfoCircleOutlined className={styles.widgetInfo} />
          </Tooltip>
        )}
        {onOpen && (
          <Tooltip title="Open">
            <ArrowRightOutlined className={styles.widgetOpen} onClick={onOpen} />
          </Tooltip>
        )}
      </div>
      <div className={styles.widgetBody}>{body}</div>
    </div>
  );
}
