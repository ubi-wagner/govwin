"""
Template drafter — uses Claude to generate email templates.

Given a prompt, tone, and expected variables, Claude generates:
  - Subject line template with {{variable}} placeholders
  - HTML email body
  - Plain text version
"""
import json
import logging
import anthropic

logger = logging.getLogger('cms.template_drafter')


async def draft_template(
    prompt: str,
    category: str = 'transactional',
    tone: str = 'professional',
    variables: list[str] | None = None,
    model: str = 'claude-sonnet-4-20250514',
    temperature: float = 0.7,
) -> dict:
    """
    Use Claude to draft an email template.

    Returns:
    {
        "name": str,
        "subject_template": str,
        "body_html": str,
        "body_text": str,
        "variables": [{"name": str, "description": str}],
        "description": str,
    }
    """
    client = anthropic.AsyncAnthropic()

    variable_instructions = ''
    if variables:
        variable_instructions = (
            f'\nUse these template variables (double curly braces): '
            f'{", ".join(f"{{{{{v}}}}}" for v in variables)}'
        )

    system = (
        'You are an email template designer for the SBIR Engine, a platform that helps '
        'small businesses win federal R&D funding. Write clean, professional emails that '
        'are mobile-friendly and accessible. Use inline CSS for HTML emails. '
        f'Tone: {tone}. Category: {category}.'
    )

    user_prompt = (
        f'{prompt}\n\n'
        f'{variable_instructions}\n\n'
        'Respond with a JSON object containing:\n'
        '- "name": string (template name, e.g. "Welcome Email")\n'
        '- "description": string (what this template is for)\n'
        '- "subject_template": string (email subject with {{variables}})\n'
        '- "body_html": string (complete HTML email, inline CSS, mobile-responsive)\n'
        '- "body_text": string (plain text version)\n'
        '- "variables": array of {"name": string, "description": string}\n\n'
        'Return ONLY valid JSON, no markdown fences.'
    )

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=8192,
            temperature=temperature,
            system=system,
            messages=[{'role': 'user', 'content': user_prompt}],
        )

        content = response.content[0].text if response.content else '{}'
        # Strip markdown fences if present
        text = content.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text[3:]
            if text.endswith('```'):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        logger.info(f'Template drafted: "{result.get("name", "Untitled")}"')
        return result

    except json.JSONDecodeError as e:
        logger.error(f'[draft_template] Failed to parse response: {e}')
        raise ValueError(f'Claude returned invalid JSON: {str(e)[:200]}')
    except Exception as e:
        logger.error(f'[draft_template] Error: {e}')
        raise


async def interpret_reply(
    reply_body: str,
    original_subject: str | None = None,
    original_body_preview: str | None = None,
    model: str = 'claude-sonnet-4-20250514',
) -> dict:
    """
    Use Claude to interpret an email reply.

    Returns:
    {
        "sentiment": "positive" | "neutral" | "negative" | "urgent",
        "intent": "question" | "interest" | "complaint" | "unsubscribe" | "out_of_office" | "other",
        "summary": str,
        "action_needed": bool,
        "suggested_response": str | null,
    }
    """
    client = anthropic.AsyncAnthropic()

    context = ''
    if original_subject:
        context += f'\nOriginal subject: {original_subject}'
    if original_body_preview:
        context += f'\nOriginal email preview: {original_body_preview[:500]}'

    user_prompt = (
        f'Analyze this email reply and classify it.{context}\n\n'
        f'Reply:\n{reply_body[:2000]}\n\n'
        'Respond with a JSON object containing:\n'
        '- "sentiment": "positive" | "neutral" | "negative" | "urgent"\n'
        '- "intent": "question" | "interest" | "complaint" | "unsubscribe" | "out_of_office" | "other"\n'
        '- "summary": string (1-2 sentence summary)\n'
        '- "action_needed": boolean (does this need a human response?)\n'
        '- "suggested_response": string or null (brief suggested reply if action needed)\n\n'
        'Return ONLY valid JSON.'
    )

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            temperature=0.3,
            system='You are an email analyst. Classify incoming replies concisely and accurately.',
            messages=[{'role': 'user', 'content': user_prompt}],
        )

        content = response.content[0].text if response.content else '{}'
        text = content.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text[3:]
            if text.endswith('```'):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        return result

    except Exception as e:
        logger.error(f'[interpret_reply] Error: {e}')
        return {
            'sentiment': 'neutral',
            'intent': 'other',
            'summary': 'Could not interpret reply',
            'action_needed': True,
            'suggested_response': None,
        }
