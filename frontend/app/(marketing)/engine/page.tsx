import { redirect } from 'next/navigation';

// /engine consolidated into the unified "Why RFP Pipeline" arc (V8 launch review):
// the Expert + AI + Process model and its differentiators now live on /value.
export default function EnginePage() {
  redirect('/value');
}
