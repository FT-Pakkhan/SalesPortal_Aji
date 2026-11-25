'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Select, Space } from 'antd';
import { FileTextOutlined, UndoOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import dayjs, { type Dayjs } from 'dayjs';
import { reportsAPI } from '@/lib/apiClient';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import { EmailPdfModal, PdfViewerModal, type PortalPdf } from '@/components/ui/PdfViewer';
import type { ReportChoice, RunnableReport } from '@/types';

/** Dates on screen as in SAP B1 */
const DATE_FORMAT = 'DD.MM.YY';
const DATETIME_FORMAT = 'DD.MM.YY HH:mm';

type Param = RunnableReport['params'][number];

/** Form field of a parameter (a range has two: From / To) */
const fieldOf = (p: Param, part?: 'from' | 'to') => `p${p.lineNum}${part ? `_${part}` : ''}`;

/** The parameter's Default Value as a form value (a date may be TODAY) */
function defaultOf(p: Param): unknown {
  const d = p.defaultValue?.trim();
  if (!d) return undefined;
  switch (p.paramType) {
    case 'DATE':
    case 'DATETIME': {
      if (d.toUpperCase() === 'TODAY') return dayjs().startOf('day');
      const parsed = dayjs(d);
      return parsed.isValid() ? parsed : undefined;
    }
    case 'INTEGER':
    case 'DECIMAL':
      return Number.isFinite(Number(d)) ? Number(d) : undefined;
    case 'BOOLEAN':
      return ['Y', 'YES', 'TRUE', '1'].includes(d.toUpperCase());
    default:
      return p.allowMulti ? [d] : d;
  }
}

/** A form value as sent to the server: dates as yyyy-MM-dd / yyyy-MM-ddTHH:mm */
function sendValue(p: Param, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (dayjs.isDayjs(v)) return (v as Dayjs).format(p.paramType === 'DATETIME' ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD');
  return v;
}

/**
 * Run a report (opened from the sidebar's Reports tree): one row per parameter as set up in Report Settings - typed, ticked, picked from a
 * date, or chosen from a list (several values where allowed; From / To for a range). Run shows the PDF.
 */
export default function ReportRun({ docEntry }: { docEntry: number }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [report, setReport] = useState<RunnableReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<Record<number, ReportChoice[]>>({});
  const [result, setResult] = useState<(PortalPdf & { values: Record<string, unknown> }) | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    reportsAPI
      .getById(docEntry)
      .then(async (res) => {
        if (!res.success) return;
        setReport(res.data);
        // The lists to choose from, one query per Choose from List parameter
        const lists: Record<number, ReportChoice[]> = {};
        for (const p of res.data.params.filter((x) => x.inputType === 'LIST')) {
          try {
            const c = await reportsAPI.getChoices(docEntry, p.lineNum as number);
            if (c.success) lists[p.lineNum as number] = c.data;
          } catch (error) {
            const text = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
            message.error(`${p.caption}: ${text || 'failed to load the list'}`);
          }
        }
        setChoices(lists);
      })
      .catch(() => {
        message.error('This report is not available to you');
        router.push('/dashboard');
      })
      .finally(() => setLoading(false));
  }, [docEntry]);

  const defaults = () => {
    const values: Record<string, unknown> = {};
    for (const p of report?.params ?? []) {
      if (p.isRange) values[fieldOf(p, 'from')] = defaultOf(p);
      else values[fieldOf(p)] = defaultOf(p);
    }
    return values;
  };

  // Fill the defaults once the form is on screen
  useEffect(() => {
    if (!loading && report) form.setFieldsValue(defaults());
  }, [loading]);

  const handleReset = () => {
    form.resetFields();
    form.setFieldsValue(defaults());
  };

  const handleRun = async (formValues: Record<string, unknown>) => {
    if (!report) return;
    const values: Record<string, unknown> = {};
    for (const p of report.params) {
      if (p.isRange) {
        values[p.paramName] = { from: sendValue(p, formValues[fieldOf(p, 'from')]), to: sendValue(p, formValues[fieldOf(p, 'to')]) };
      } else {
        const v = formValues[fieldOf(p)];
        values[p.paramName] = Array.isArray(v) ? v.map((x) => sendValue(p, x)) : sendValue(p, v);
      }
    }
    try {
      const blob = await reportsAPI.run(docEntry, values);
      // The values are kept: E-mail sends the report run with exactly these
      setResult({ title: report.reportName, url: URL.createObjectURL(blob), blob, fileName: report.reportName, values });
    } catch (error) {
      // The answer was asked for as a file, so an error message arrives as a Blob holding the JSON
      const data = (error as { response?: { data?: unknown } }).response?.data;
      let text = 'Failed to run the report';
      if (data instanceof Blob) {
        try {
          text = (JSON.parse(await data.text()) as { error?: string }).error || text;
        } catch {
          /* not JSON: keep the general message */
        }
      }
      message.error(text, 8);
    }
  };

  const closeResult = () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  };

  if (loading || !report) return null;

  /** The box for one value of a parameter */
  const control = (p: Param, part?: 'from' | 'to') => {
    const placeholder = part === 'from' ? 'From' : part === 'to' ? 'To' : undefined;
    const multi = p.allowMulti && !part;
    if (p.inputType === 'LIST') {
      const options = (choices[p.lineNum as number] ?? []).map((c) => ({
        value: c.value as string | number,
        label: c.description != null && c.description !== '' && c.description !== c.value ? `${c.value} - ${c.description}` : String(c.value),
      }));
      return (
        <Select
          mode={multi ? 'multiple' : undefined}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={placeholder ?? 'Choose'}
          options={options}
          maxTagCount="responsive"
        />
      );
    }
    switch (p.paramType) {
      case 'DATE':
        return <DatePicker format={DATE_FORMAT} placeholder={placeholder} />;
      case 'DATETIME':
        return <DatePicker showTime={{ format: 'HH:mm' }} format={DATETIME_FORMAT} placeholder={placeholder} />;
      case 'BOOLEAN':
        return <Checkbox />;
      case 'INTEGER':
      case 'DECIMAL':
        // Several numbers: typed one by one into a tag box
        return multi ? (
          <Select mode="tags" open={false} tokenSeparators={[',']} placeholder="Type a value, press Enter" />
        ) : (
          <InputNumber controls={false} precision={p.paramType === 'INTEGER' ? 0 : undefined} placeholder={placeholder} style={{ width: '100%' }} />
        );
      default:
        return multi ? <Select mode="tags" open={false} tokenSeparators={[',']} placeholder="Type a value, press Enter" /> : <Input placeholder={placeholder} />;
    }
  };

  const required = (p: Param) => (p.mandatory && p.paramType !== 'BOOLEAN' ? [{ required: true, message: `${p.caption} is required` }] : []);

  const toolbar = (
    <>
      <Button type="primary" icon={<FileTextOutlined />} onClick={() => form.submit()}>
        Run
      </Button>
      <Button icon={<UndoOutlined />} onClick={handleReset}>
        Reset
      </Button>
    </>
  );

  return (
    <>
      <Form form={form} {...detailFormProps(true)} onFinish={handleRun}>
        <DetailView toolbar={toolbar} title={`Report - ${report.reportName}`}>
          {report.remarks && (
            <Form.Item label="Remarks">
              <ReadOnlyText value={report.remarks} multiline />
            </Form.Item>
          )}
          {report.params.length === 0 && (
            <Form.Item label="Parameters">
              <ReadOnlyText value="None - click Run" />
            </Form.Item>
          )}
          {report.params.map((p) =>
            p.isRange ? (
              // From - To on one row; mandatory = at least one end filled
              <Form.Item key={p.lineNum} label={p.caption} required={p.mandatory}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item
                    name={fieldOf(p, 'from')}
                    noStyle
                    dependencies={[fieldOf(p, 'to')]}
                    rules={
                      p.mandatory
                        ? [
                            ({ getFieldValue }) => ({
                              validator: (_, v) =>
                                v != null && v !== '' ? Promise.resolve() : getFieldValue(fieldOf(p, 'to')) != null && getFieldValue(fieldOf(p, 'to')) !== ''
                                  ? Promise.resolve()
                                  : Promise.reject(new Error(`${p.caption} is required`)),
                            }),
                          ]
                        : []
                    }
                  >
                    {control(p, 'from')}
                  </Form.Item>
                  <Form.Item name={fieldOf(p, 'to')} noStyle>
                    {control(p, 'to')}
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            ) : (
              <Form.Item
                key={p.lineNum}
                label={p.caption}
                name={fieldOf(p)}
                rules={required(p)}
                valuePropName={p.paramType === 'BOOLEAN' ? 'checked' : 'value'}
              >
                {control(p)}
              </Form.Item>
            )
          )}
        </DetailView>
      </Form>

      {/* The report, in the browser's PDF viewer, with Share; E-mail only when Allow E-mail is ticked in Report Settings > E-mail */}
      <PdfViewerModal pdf={result} onClose={closeResult} onEmail={report.emailAllowed ? () => setEmailOpen(true) : undefined} />

      {result && (
        <EmailPdfModal
          open={emailOpen}
          title="E-mail Report"
          loadDraft={() => reportsAPI.getEmailDraft(docEntry, result.values)}
          send={(fields) => reportsAPI.sendEmail(docEntry, { values: result.values, ...fields })}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </>
  );
}

