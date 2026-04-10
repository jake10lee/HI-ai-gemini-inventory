export type InvoiceType = 'purchase' | 'sales';

export interface InventoryItem {
  id?: string;
  type: InvoiceType;
  date: string;
  company: string;
  brand: string;
  name: string;
  spec: string;
  code: string;
  quantity: number;
  unit: string;
  price: number;
  timestamp?: any;
}

export interface ProcessingStatus {
  active: boolean;
  total: number;
  current: number;
}
