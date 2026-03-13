import json
import os

from zerver.actions.create_realm import do_create_realm
from zerver.actions.create_user import do_create_user, do_reactivate_user
from zerver.actions.message_send import internal_send_stream_message
from zerver.actions.streams import bulk_add_subscriptions
from zerver.lib.streams import create_stream_if_needed
from zerver.models import Message, Realm, Recipient, UserProfile

REALM_SUBDOMAIN = os.environ.get("FOUNDRY_DEMO_REALM_SUBDOMAIN", "foundry-labs").strip().lower()
REALM_NAME = os.environ.get("FOUNDRY_DEMO_REALM_NAME", "Foundry Labs").strip() or "Foundry Labs"
DEFAULT_PASSWORD = os.environ.get("FOUNDRY_DEMO_PASSWORD", "FoundryDemo2026!")

TEAM_SPECS = (
    {
        "email": "maya@foundry.dev",
        "full_name": "Maya Chen",
        "role": UserProfile.ROLE_REALM_OWNER,
    },
    {
        "email": "niko@foundry.dev",
        "full_name": "Niko Alvarez",
        "role": UserProfile.ROLE_REALM_ADMINISTRATOR,
    },
    {
        "email": "sara@foundry.dev",
        "full_name": "Sara Park",
        "role": UserProfile.ROLE_REALM_ADMINISTRATOR,
    },
    {
        "email": "leo@foundry.dev",
        "full_name": "Leo Brooks",
        "role": UserProfile.ROLE_MEMBER,
    },
    {
        "email": "ivy@foundry.dev",
        "full_name": "Ivy Nguyen",
        "role": UserProfile.ROLE_MEMBER,
    },
)
TEAM_EMAILS = tuple(spec["email"] for spec in TEAM_SPECS)

STREAM_SPECS = (
    {
        "name": "foundry-platform",
        "description": "Cross-functional product and architecture decisions for building Foundry.",
    },
    {
        "name": "runtime-agents",
        "description": "Provider auth, delegated agents, workspace topology, and execution reliability.",
    },
    {
        "name": "desktop",
        "description": "Desktop client polish, release QA, and GitHub-facing screenshots.",
    },
    {
        "name": "ict",
        "description": "ICT strategy, trading-product experiments, and end-to-end execution topics.",
    },
    {
        "name": "release",
        "description": "Milestones, risks, launch checklists, and operator coordination.",
    },
    {
        "name": "design",
        "description": "Visual language, docs, and marketing-ready product narrative.",
    },
)

TOPIC_SPECS = (
    {
        "stream": "foundry-platform",
        "topic": "Codex OAuth rollout",
        "messages": (
            (
                "maya@foundry.dev",
                "We need Codex OAuth to feel boring in the best way: connect once, pick a model, and let delegated agents inherit the same access.",
            ),
            (
                "leo@foundry.dev",
                "Backend path is in place now. The important behavior is that sub-agents resolve the shared provider credential instead of opening a second auth flow.",
            ),
            (
                "niko@foundry.dev",
                "I also want disconnect to clear the state everywhere. DevLive was keeping stale provider state, which made the runtime look healthy when the credential was gone.",
            ),
            (
                "maya@foundry.dev",
                "Decision: default provider stays Codex for this tenant, model hint stays `gpt-5-codex`, and Claude Code remains our explicit review fallback.",
            ),
        ),
    },
    {
        "stream": "foundry-platform",
        "topic": "DevLive consolidation",
        "messages": (
            (
                "niko@foundry.dev",
                "I shut down the extra dev surface and kept DevLive as the single active core stack. Fewer branches in the road means faster validation.",
            ),
            (
                "sara@foundry.dev",
                "That helps a lot on desktop QA. I can point the client at one Foundry server and one tenant app instead of guessing which environment has the latest code.",
            ),
            (
                "maya@foundry.dev",
                "Good. Keep the mental model simple: one dev server, one demo company, one place to verify the product story end to end.",
            ),
        ),
    },
    {
        "stream": "runtime-agents",
        "topic": "Delegate topology for build tasks",
        "messages": (
            (
                "leo@foundry.dev",
                "Proposed delegate set for the demo org:\n- Spec Captain\n- Runtime Chief\n- Desktop Polish\n- Release Review\n- Docs Ship",
            ),
            (
                "niko@foundry.dev",
                "That lines up with how the team actually works. Supervisor should keep the user-facing conversation unified while the delegates do specialized work behind the scenes.",
            ),
            (
                "maya@foundry.dev",
                "Make sure inheritance is the default. I want Foundry to override only the things we can explain clearly: provider, model hint, and task scope.",
            ),
            (
                "leo@foundry.dev",
                "Agreed. The runtime preset should stay the baseline, then explicit overrides only where the product needs tighter control.",
            ),
        ),
    },
    {
        "stream": "runtime-agents",
        "topic": "Workspace pool sizing",
        "messages": (
            (
                "niko@foundry.dev",
                "For the demo tenant I set pool size to 6 and max concurrency to 12. That is enough to show parallel agent work without burning the host.",
            ),
            (
                "leo@foundry.dev",
                "Mirror path points at `meridian/foundry`, which is exactly what we want for screenshots. The story is that this company is using Foundry to build Foundry.",
            ),
            (
                "maya@foundry.dev",
                "Perfect. Keep the numbers believable, not maximal.",
            ),
        ),
    },
    {
        "stream": "desktop",
        "topic": "GitHub page screenshots",
        "messages": (
            (
                "ivy@foundry.dev",
                "I want screenshots that look like a real operating company, not a toy demo. Give me streams, active topics, and a clean runtime story.",
            ),
            (
                "sara@foundry.dev",
                "I can capture desktop once the demo tenant has real team chatter. Empty channels make the app feel unfinished even when the mechanics work.",
            ),
            (
                "maya@foundry.dev",
                "Use the five-person team narrative. People should instantly understand that Foundry coordinates product, runtime, desktop, release, and design work in one place.",
            ),
            (
                "ivy@foundry.dev",
                "Then I will update the GitHub README hero shots and the settings views to match that story.",
            ),
        ),
    },
    {
        "stream": "ict",
        "topic": "lct-index",
        "messages": (
            (
                "maya@foundry.dev",
                "We want to recreate ictindex.io.",
            ),
            (
                "leo@foundry.dev",
                "Treat this as a real delivery workflow: repo, implementation plan, worker dispatch, and visible delivery evidence.",
            ),
            (
                "niko@foundry.dev",
                "I will keep the dev worker backend and preview path ready so the supervisor can move from plan to execution without fake completion.",
            ),
        ),
    },
    {
        "stream": "release",
        "topic": "v0.1 launch checklist",
        "messages": (
            (
                "maya@foundry.dev",
                "Launch bar for the next milestone:\n- Codex OAuth lifecycle is stable\n- delegated runtime inherits credentials\n- desktop screenshots match real data\n- one dev environment is the source of truth",
            ),
            (
                "niko@foundry.dev",
                "I will own the infrastructure and tenant provisioning checks.",
            ),
            (
                "sara@foundry.dev",
                "I will own the desktop validation pass against DevLive and make sure the login, inbox, and settings surfaces all feel coherent.",
            ),
            (
                "ivy@foundry.dev",
                "I will own the README assets, app screenshots, and the small copy edits that make the product story easier to read.",
            ),
        ),
    },
    {
        "stream": "design",
        "topic": "Foundry visual language",
        "messages": (
            (
                "ivy@foundry.dev",
                "Reminder to ourselves: avoid generic SaaS gradients. Foundry should read as a serious builder tool with enough warmth to feel intentional.",
            ),
            (
                "sara@foundry.dev",
                "That maps well to the desktop shell. If the seeded data looks sharp, the rest of the product screenshots will follow.",
            ),
            (
                "maya@foundry.dev",
                "Ship the honest version. The app should look like a team already depends on it every day.",
            ),
        ),
    },
)


def ensure_realm() -> tuple[Realm, bool]:
    realm = Realm.objects.filter(string_id=REALM_SUBDOMAIN).first()
    if realm is not None:
        return realm, False

    realm = do_create_realm(
        REALM_SUBDOMAIN,
        REALM_NAME,
        org_type=Realm.ORG_TYPES["business"]["id"],
        default_language="en",
        invite_required=True,
    )
    return realm, True


def ensure_user(
    realm: Realm,
    *,
    email: str,
    full_name: str,
    role: int,
    realm_creation: bool,
) -> tuple[UserProfile, bool]:
    user = UserProfile.objects.filter(realm=realm, delivery_email__iexact=email).first()
    if user is None:
        user = do_create_user(
            email,
            DEFAULT_PASSWORD,
            realm,
            full_name,
            role=role,
            realm_creation=realm_creation,
            tos_version=UserProfile.TOS_VERSION_BEFORE_FIRST_LOGIN,
            acting_user=None,
        )
        return user, True

    changed = False
    if user.full_name != full_name:
        user.full_name = full_name
        changed = True
    if user.role != role:
        user.role = role
        changed = True
    if changed:
        user.save(update_fields=["full_name", "role"])
    if not user.is_active:
        do_reactivate_user(user, acting_user=None)
    return user, False


realm, realm_created = ensure_realm()
created_users = []
users = []
user_by_email = {}
for index, spec in enumerate(TEAM_SPECS):
    user, created = ensure_user(
        realm,
        email=spec["email"],
        full_name=spec["full_name"],
        role=spec["role"],
        realm_creation=realm_created and index == 0,
    )
    users.append(user)
    user_by_email[user.delivery_email.lower()] = user
    if created:
        created_users.append(user.delivery_email.lower())
owner = user_by_email["maya@foundry.dev"]

if hasattr(realm, "description"):
    description = "Foundry Labs uses Foundry to build Foundry."
    if realm.description != description:
        realm.description = description
        realm.save(update_fields=["description"])

stream_by_name = {}
for spec in STREAM_SPECS:
    stream, _created = create_stream_if_needed(
        realm,
        spec["name"],
        stream_description=spec["description"],
        acting_user=owner,
    )
    stream_by_name[spec["name"]] = stream

bulk_add_subscriptions(realm, stream_by_name.values(), users, acting_user=owner)

seeded_topics = []
skipped_topics = []
for spec in TOPIC_SPECS:
    stream = stream_by_name[spec["stream"]]
    topic = spec["topic"]
    exists = Message.objects.filter(
        realm=realm,
        recipient__type=Recipient.STREAM,
        recipient__type_id=stream.id,
        subject__iexact=topic,
    ).exists()
    if exists:
        skipped_topics.append(f"{stream.name}>{topic}")
        continue
    for sender_email, content in spec["messages"]:
        sender = user_by_email[sender_email]
        internal_send_stream_message(sender, stream, topic, content, acting_user=sender)
    seeded_topics.append(f"{stream.name}>{topic}")

print(
    json.dumps(
        {
            "realm_subdomain": REALM_SUBDOMAIN,
            "realm_created": realm_created,
            "created_users": created_users,
            "stream_count": len(stream_by_name),
            "seeded_topics": seeded_topics,
            "skipped_topics": skipped_topics,
        },
        indent=2,
    )
)
