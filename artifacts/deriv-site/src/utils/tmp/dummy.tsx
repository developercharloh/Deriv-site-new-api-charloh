import React from 'react';

// Placeholder Icon component — replace with the real Deriv Icon once available.
export type TIconProps = {
    className?: string;
    color?: string;
    custom_color?: string;
    data_testid?: string;
    height?: number | string;
    icon?: string;
    onClick?: React.MouseEventHandler;
    onMouseDown?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onTouchStart?: () => void;
    size?: number | string;
    width?: number | string;
    id?: string;
    description?: string;
};

export const Icon = ({ icon, className, size, color, data_testid, ...rest }: TIconProps) => (
    <span
        className={className}
        data-testid={data_testid ?? icon}
        aria-hidden='true'
        style={{ display: 'inline-block', width: size, height: size, color }}
        {...rest}
    />
);

export default Icon;
