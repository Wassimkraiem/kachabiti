-- Messages the team sends often (prices, greeting), picked in Admin → Messenger (/api/crm/replies).

create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  body text not null check (length(trim(body)) between 1 and 2000),
  position integer not null default 0,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists saved_replies_live on public.saved_replies (position, created_at) where deleted_at is null;
alter table public.saved_replies enable row level security;

create trigger prevent_hard_delete before delete on public.saved_replies
  for each row execute function private.prevent_hard_delete();
create trigger set_updated_at before update on public.saved_replies
  for each row execute function private.set_updated_at();
create trigger log_activity after insert or update on public.saved_replies
  for each row execute function private.log_activity();

-- The shop's own messages (26 Nov 2026), in the order they are sent.
insert into public.saved_replies (title, body, position) values
  ('مرحبا', 'عسلامة مرحبا بيك 🌹', 0),
  ('Pack duo', E'و عنا pack duo \nقشابية صوف طويلة \nقشابية صوف demi \nالزوز ب 259 د ✅ في عوض 338 د ❌', 1),
  ('قشابية صوف عربي زمنية', 'القشابية الصوف العربي الزمنية ب 269 دينار 💸 معلوم التوصيل 8 دينارات', 2),
  ('قشابية صوف عربي تيبار', 'القشابية الصوف العربي تيبار سومها 230 دينار 💸 معلوم التوصيل 8 دينارات عاملين تخفيض تولي ب 169 دينار 💸', 3),
  ('قشابية صوف وزرة دمي', 'القشابية الصوف الوزرة دمي سومها 139 دينار 💸 في عوض 189 دينار 💸 معلوم التوصيل 8 دينارات', 4),
  ('كدرون صوف زمني عربي', 'الكدرون الصوف الزمني العربي سومو 160 دينار 💸 معلوم التوصيل 8 دينارات', 5),
  ('قشابية دمي ألوان', 'قشابية دمي ألوان سومها 69 دينار 💸 معلوم التوصيل 8 دينارات', 6),
  ('قشابية وبر', 'قشابية وبر سومها 109 دينارات 💸 معلوم التوصيل 8 دينارات', 7),
  ('قشابية النور', 'قشابية النور سومها 189 دينار 💸 معلوم التوصيل 8 دينارات', 8),
  ('قميص الصلاة', 'قميص الصلاة سومو 59 دينار 💸 معلوم التوصيل 8 دينارات', 9),
  ('قشابية دمي ألوان خياطة يد', 'قشابية دمي ألوان خدمة و خياطة يد سومها 79 دينار 💸 معلوم التوصيل 8 دينارات', 10),
  ('قشابية كاشمير وبر ماعز', 'القشابية كاشمير وبر ماعز سومها 79 دينار 💸 كي تاخوا زوز 150 دينار 💸', 11),
  ('برنوس وبري', 'البرنوس وبري سومو 129 دينار 💸 معلوم التوصيل 8 دينارات', 12),
  ('قشابية صوف Pro Max 2027', E'القشابية الصوف   Pro Max  مودال 2027 \nموديل الجديد \n💸 السعر: 149دينار 💸 معلوم التوصيل 8 دينارات \nالجودة من اروع ماتشوف💯💯', 13),
  ('برنوس صوف زمني عربي', 'البرنوس الصوف الزمني العربي ب 380 دينار 💸 معلوم التوصيل 8 دينارات', 14),
  ('دنقري الانتيشار', 'الدنقري الانتيشار الاصلي سلعة فرنسا سومو 119 دينار 💸 معلوم التوصيل 8 دينارات', 15),
  ('بلوزة جربية', 'البلوزة الجربية سومها 79 دينار 💸 معلوم التوصيل 8 دينارات', 16),
  ('دنقري منقوش', 'دنقري منقوش في تخفيض سومو 79 دينار 💸 معلوم التوصيل 8 دينارات', 17),
  ('مريول بحرية', 'مريول بحرية سومو 28 دينار 💸 معلوم التوصيل 8 دينارات', 18),
  ('مريول قمراية مطروز', 'مريول قمراية مطروز سومو 42 دينار 💸 معلوم التوصيل 8 دينارات', 19),
  ('مريول عالقمراية', 'مريول عالقمراية سومو 32 دينار 💸 معلوم التوصيل 8 دينارات', 20);
