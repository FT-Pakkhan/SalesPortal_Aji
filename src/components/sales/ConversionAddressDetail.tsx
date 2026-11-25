'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Checkbox, Form, Input, Modal, Select } from 'antd';
import { ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import type { ConversionAddress, SapAddressLists } from '@/types';

/** Address types, as SAP B1: Bill To / Ship To */
export const ADDRESS_TYPES: { value: ConversionAddress['adresType']; label: string }[] = [
  { value: 'B', label: 'Bill To' },
  { value: 'S', label: 'Ship To' },
];
export const addressTypeLabel = (v: string) => ADDRESS_TYPES.find((t) => t.value === v)?.label ?? v;

type DeliveryZone = SapAddressLists['deliveryZones'][number];
/** A delivery zone as shown: Code - Name (Area, City, State); the Name left out when it is the Code again */
export const deliveryZoneLabel = (z: DeliveryZone) => {
  const where = [z.area, z.city, z.state].filter(Boolean).join(', ');
  const name = z.name && z.name !== z.code ? ` - ${z.name}` : '';
  return `${z.code}${name}${where ? ` (${where})` : ''}`;
};

interface ConversionAddressDetailProps<T extends ConversionAddress> {
  /** The address shown; null = closed */
  address: T | null;
  isNew: boolean;
  /** Edit mode: fields can be changed; otherwise read-only with Close */
  editable: boolean;
  lists: Pick<SapAddressLists, 'countries' | 'states' | 'deliveryZones'>;
  onOk: (address: T) => void;
  onCancel: () => void;
}

/**
 * One Convert to Customer address in a popup, as SAP B1's BP address: Type, Address ID, Address Lines 1-4 (SAP Street,
 * StreetNo, Block, City), Postcode, Country, State (the chosen country's states), Delivery Zone (SAP UDT
 * @DELIVERYZONE) and Default.
 */
export default function ConversionAddressDetail<T extends ConversionAddress>({
  address,
  isNew,
  editable,
  lists,
  onOk,
  onCancel,
}: ConversionAddressDetailProps<T>) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<T | null>(address);

  useEffect(() => {
    setDraft(address);
  }, [address]);

  if (!draft) return null;

  const update = (changes: Partial<ConversionAddress>) => setDraft((prev) => (prev ? { ...prev, ...changes } : prev));
  const countryName = lists.countries.find((c) => c.code === draft.country)?.name ?? draft.country ?? '';
  const states = lists.states.filter((s) => s.country === draft.country);
  const stateName = states.find((s) => s.code === draft.state)?.name ?? draft.state ?? '';
  const zone = lists.deliveryZones.find((z) => z.code === draft.deliveryZone);
  const zoneText = zone ? deliveryZoneLabel(zone) : draft.deliveryZone ?? '';

  /**
   * A chosen delivery zone fills in State (and its Country) when the zone's state matches an SAP state by name or code
   * (ignoring case): the current country's state first, otherwise the only match. No match: State is left as it is.
   */
  const chooseZone = (code: string | null) => {
    const changes: Partial<ConversionAddress> = { deliveryZone: code };
    const zoneState = lists.deliveryZones.find((z) => z.code === code)?.state?.trim().toLowerCase();
    if (zoneState) {
      const matches = lists.states.filter((s) => s.name?.trim().toLowerCase() === zoneState || s.code.trim().toLowerCase() === zoneState);
      const match = matches.find((s) => s.country === draft.country) ?? (matches.length === 1 ? matches[0] : undefined);
      if (match) {
        changes.country = match.country;
        changes.state = match.code;
      }
    }
    update(changes);
  };

  const handleOk = () => {
    if (!draft.address.trim()) {
      message.error('Address ID is required');
      return;
    }
    // Required whenever SAP has delivery zones to choose from
    if (lists.deliveryZones.length > 0 && !draft.deliveryZone) {
      message.error('Delivery Zone is required');
      return;
    }
    onOk({ ...draft, address: draft.address.trim() });
  };

  const footer = editable
    ? [
        <Button key="cancel" onClick={onCancel}>Cancel</Button>,
        <Button key="ok" type="primary" onClick={handleOk}>OK</Button>,
      ]
    : [<Button key="close" onClick={onCancel}>Close</Button>];

  /** A text field: a textbox in edit mode, plain text in view mode */
  const textField = (label: string, key: 'address' | 'street' | 'streetNo' | 'block' | 'city' | 'zipCode', max: number, required = false) => (
    <Form.Item label={label} required={required}>
      {editable ? (
        <Input value={draft[key] ?? ''} maxLength={max} onChange={(e) => update({ [key]: e.target.value || (key === 'address' ? '' : null) })} />
      ) : (
        <ReadOnlyText value={draft[key] ?? ''} />
      )}
    </Form.Item>
  );

  return (
    <Modal title={`Address${isNew ? ' - New' : ''}`} open={!!address} onCancel={onCancel} footer={footer} width={560} destroyOnHidden>
      {/* Same look as a detail view: label : value rows */}
      <div className={detailStyles.fields}>
        <Form {...detailFormProps(editable)}>
          <Form.Item label="Type" required>
            {editable ? (
              <Select value={draft.adresType} options={ADDRESS_TYPES} onChange={(v) => update({ adresType: v })} />
            ) : (
              <ReadOnlyText value={addressTypeLabel(draft.adresType)} />
            )}
          </Form.Item>
          {textField('Address ID', 'address', 50, true)}
          {/* SAP CRD1: Street, StreetNo, Block, City (100 characters each, as SAP) */}
          {textField('Address Line 1', 'street', 100)}
          {textField('Address Line 2', 'streetNo', 100)}
          {textField('Address Line 3', 'block', 100)}
          {textField('Address Line 4', 'city', 100)}
          {textField('Postcode', 'zipCode', 20)}
          {/* SAP UDF CRD1.U_DeliveryZone, linked to UDT @DELIVERYZONE; choosing one fills in State / Country when they match */}
          <Form.Item label="Delivery Zone" required={editable && lists.deliveryZones.length > 0}>
            {editable ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select a delivery zone"
                value={draft.deliveryZone ?? undefined}
                options={lists.deliveryZones.map((z) => ({ value: z.code, label: deliveryZoneLabel(z) }))}
                onChange={(v) => chooseZone(v ?? null)}
              />
            ) : (
              <ReadOnlyText value={zoneText} />
            )}
          </Form.Item>
          <Form.Item label="Country">
            {editable ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select a country"
                value={draft.country ?? undefined}
                options={lists.countries.map((c) => ({ value: c.code, label: c.name }))}
                // Another country: its states are different, so the state is cleared
                onChange={(v) => update({ country: v ?? null, state: null })}
              />
            ) : (
              <ReadOnlyText value={countryName} />
            )}
          </Form.Item>
          <Form.Item label="State">
            {editable ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={draft.country ? 'Select a state' : 'Select the country first'}
                disabled={!draft.country}
                value={draft.state ?? undefined}
                options={states.map((s) => ({ value: s.code, label: s.name }))}
                onChange={(v) => update({ state: v ?? null })}
              />
            ) : (
              <ReadOnlyText value={stateName} />
            )}
          </Form.Item>
          {/* One default per type: ticking this one moves the default here */}
          <Form.Item label="Default">
            <Checkbox checked={draft.isDefault} disabled={!editable} onChange={(e) => update({ isDefault: e.target.checked })} />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}
