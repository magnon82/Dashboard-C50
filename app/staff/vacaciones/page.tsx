import { redirect } from 'next/navigation';

/** Mis vacaciones — oculto hasta que cada empleado tenga usuario. Cliente en StaffVacacionesClient. */
export default function StaffVacacionesPage() {
  redirect('/staff');
}
