import { requireAdminOrRedirect } from '@/lib/session';
import { AdminTopBar } from '@/components/admin/AdminTopBar';
import { VoiceTrainer } from '@/components/admin/VoiceTrainer';

export const dynamic = 'force-dynamic';

export default async function VoiceTrainingPage() {
  await requireAdminOrRedirect();
  return (
    <>
      <AdminTopBar title="Voice training" subtitle="Studio · Teach the AI your voice" />
      <VoiceTrainer />
    </>
  );
}
