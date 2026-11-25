'use client';

import React, { useState, useEffect, useRef } from 'react';
import { App, Button, Form, Input, InputNumber } from 'antd';
import { SaveOutlined, EditOutlined, PlusOutlined, UserAddOutlined, UserDeleteOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { approvalStagesAPI } from '@/lib/apiClient';
import { useCanChange } from '@/stores/accessStore';
import { DetailView, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import UserLookup from '@/components/admin/UserLookup';
import type { ApprovalStageApprover, ApprovalStageDetail as StageDetail } from '@/types';

interface ApprovalStageDetailProps {
  /** Omit to create a new stage */
  docEntry?: number;
  /** Open an existing stage directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface StageFormValues {
  wstCode: string;
  wstName: string;
  maxReqr: number | null;
}

const toFormValues = (stage: StageDetail): StageFormValues => ({
  wstCode: stage.wstCode,
  wstName: stage.wstName,
  maxReqr: stage.maxReqr,
});

const approverColumns: ColDef<ApprovalStageApprover>[] = [
  { field: 'userName', headerName: 'Approver', flex: 1, sort: 'asc' },
];

/** Detail view of an approval stage and its approvers. Existing stages open in view mode. */
export default function ApprovalStageDetail({ docEntry, startInEdit = false }: ApprovalStageDetailProps) {
  const isNew = docEntry === undefined;
  const { message } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit
  const canChange = useCanChange();
  const router = useRouter();
  const [stage, setStage] = useState<StageDetail | null>(null);
  const [approvers, setApprovers] = useState<ApprovalStageApprover[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [form] = Form.useForm<StageFormValues>();
  const approversGridRef = useRef<DataGridHandle<ApprovalStageApprover>>(null);

  useEffect(() => {
    if (isNew) return;
    const load = async () => {
      try {
        const res = await approvalStagesAPI.getById(docEntry);
        if (res.success) {
          setStage(res.data);
          setApprovers(res.data.approvers);
        }
      } catch {
        message.error('Failed to load approval stage');
        router.push('/system/approval-stages');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && stage) form.setFieldsValue(toFormValues(stage));
  }, [loading]);

  const handleCancelEdit = () => {
    if (isNew) {
      router.push('/system/approval-stages');
      return;
    }
    // Discard unsaved changes, including added / removed approvers
    form.resetFields();
    if (stage) {
      form.setFieldsValue(toFormValues(stage));
      setApprovers(stage.approvers);
    }
    setEditing(false);
  };

  const handleSave = async (values: StageFormValues) => {
    if (!editing) return;
    if (approvers.length === 0) {
      message.error('Add at least one approver');
      return;
    }
    if ((values.maxReqr ?? 0) > approvers.length) {
      message.error(`Approval required cannot be more than the number of approvers (${approvers.length})`);
      return;
    }

    const payload = {
      wstCode: values.wstCode,
      wstName: values.wstName,
      maxReqr: values.maxReqr ?? 0,
      approverIds: approvers.map((a) => a.userId),
    };

    setSaving(true);
    try {
      if (isNew) {
        const res = await approvalStagesAPI.create(payload);
        if (res.success) {
          message.success('Approval stage created');
          router.replace(`/system/approval-stages/${res.data.docEntry}`);
        }
      } else {
        const res = await approvalStagesAPI.update(docEntry, payload);
        if (res.success) {
          message.success('Approval stage updated');
          setStage(res.data);
          setApprovers(res.data.approvers);
          form.setFieldsValue(toFormValues(res.data));
          setEditing(false);
        }
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      message.error(err.response?.data?.error || 'Failed to save approval stage');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveApprovers = () => {
    const ticked = approversGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the approvers to remove');
      return;
    }
    const removeIds = new Set(ticked.map((a) => a.userId));
    setApprovers((prev) => prev.filter((a) => !removeIds.has(a.userId)));
  };

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !stage) return null;

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
    </>
  ) : !canChange ? null : (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/system/approval-stages/new')}>
        New
      </Button>
      <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
        Edit
      </Button>
    </>
  );

  // Approvers grid: Add / Remove only in edit mode; Reset View Settings is added by the grid
  const approversToolbar = editing ? (
    <>
      <Button size="small" icon={<UserAddOutlined />} onClick={() => setLookupOpen(true)}>
        Add Approver
      </Button>
      <Button size="small" icon={<UserDeleteOutlined />} onClick={handleRemoveApprovers}>
        Remove
      </Button>
    </>
  ) : null;

  return (
    <>
      <DetailView
        toolbar={toolbar}
        title={`Approval Stage - ${isNew ? 'New' : stage?.wstCode}`}
        below={
          <DataGrid<ApprovalStageApprover>
            settingsKey="approval-stage:approvers"
            handleRef={approversGridRef}
            showToolbar
            toolbar={approversToolbar}
            gridProps={{ rowData: approvers, columnDefs: approverColumns, getRowId: (p) => String(p.data.userId) }}
          />
        }
      >
        <Form form={form} {...detailFormProps(editing)} onFinish={handleSave}>
          <Form.Item
            label="Stage Code"
            name="wstCode"
            rules={[
              { required: true, whitespace: true, message: 'Stage code is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item
            label="Description"
            name="wstName"
            rules={[
              { required: true, whitespace: true, message: 'Description is required' },
              { max: 100, message: 'Maximum 100 characters' },
            ]}
          >
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          <Form.Item
            label="Approval Required"
            name="maxReqr"
            rules={[{ required: true, message: 'Approval required is required' }]}
          >
            {editing ? <InputNumber min={1} max={32767} precision={0} /> : <ReadOnlyText />}
          </Form.Item>
        </Form>
      </DetailView>

      <UserLookup
        open={lookupOpen}
        title="Add Approver"
        excludeIds={approvers.map((a) => a.userId)}
        onCancel={() => setLookupOpen(false)}
        onSelect={(users) => {
          setApprovers((prev) => [
            ...prev,
            ...users.map((u) => ({ userId: u.id, userName: u.userName, displayName: u.displayName })),
          ]);
          setLookupOpen(false);
        }}
      />
    </>
  );
}
