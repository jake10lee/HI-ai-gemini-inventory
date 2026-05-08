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
  ctxLink?: string;
  timestamp?: any;
}

export interface ProcessingStatus {
  active: boolean;
  total: number;
  current: number;
}

export interface ContactPerson {
  name: string;
  position: string;
  phones: string[];
  emails: string[];
}

export interface Vendor {
  id?: string;
  name: string;
  orgChart: string;
  contacts: ContactPerson[];
  timestamp?: any;
}

export interface TodoItem {
  id?: string;
  task: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  completed: boolean;
}

export interface VisionGoal {
  id?: string;
  title: string;
  description: string;
  date: string;
}
