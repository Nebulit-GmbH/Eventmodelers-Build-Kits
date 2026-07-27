import {getKnexInstance} from './db';
import type {AnyRecordedMessageMetadata, RecordedMessage} from '@event-driven-io/emmett';

export const storeDlqMessage = async (
    processorId: string,
    message: RecordedMessage<any, AnyRecordedMessageMetadata>,
    error: unknown,
): Promise<void> => {

    try {
        console.log(`Processing DLQ ${JSON.stringify({ type: message.type, data: message.data, metadata: message.metadata } , (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )}`)
        await getKnexInstance()('processor_dlq').insert({
            processor_id: processorId,
            stream_id: message.metadata.streamName,
            event:  JSON.parse(
                JSON.stringify({ type: message.type, data: message.data, metadata: message.metadata } , (key, value) =>
                    typeof value === 'bigint' ? value.toString() : value
                )
            ),
            error: error instanceof Error ? error.message : String(error),
        });
    } catch (dlqError) {
        console.error('Failed to write to processor_dlq:', dlqError);
    }
};

